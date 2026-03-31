/**
 * Socket.IO Configuration and Handler
 * 
 * This module sets up Socket.IO with JWT authentication,
 * manages real-time messaging, and handles user presence.
 */

import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import { Message } from "../models/message.model.js";
import { Conversation } from "../models/conversation.model.js";

// Store for online users: Map<userId, Set<socketId>>
const onlineUsers = new Map();

// Store for socket to user mapping: Map<socketId, userId>
const socketToUser = new Map();

/**
 * Initialize Socket.IO server
 * @param {http.Server} httpServer - The HTTP server instance
 * @returns {Server} - Socket.IO server instance
 */
export function initializeSocket(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: "*", // In production, restrict this
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: 60000,
        pingInterval: 25000
    });

    // JWT Authentication Middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || 
                          socket.handshake.headers.authorization?.split(" ")[1];
            
            if (!token) {
                return next(new Error("Authentication required"));
            }

            // Verify JWT token
            const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
            
            // Get user from database
            const user = await User.findById(decoded._id).select("-password -refreshToken");
            
            if (!user) {
                return next(new Error("User not found"));
            }

            // Attach user to socket
            socket.user = user;
            socket.userId = user._id.toString();
            
            next();
        } catch (error) {
            console.error("Socket authentication error:", error.message);
            next(new Error("Invalid or expired token"));
        }
    });

    // Connection handler
    io.on("connection", (socket) => {
        const userId = socket.userId;
        const user = socket.user;
        
        console.log(`User connected: ${user.firstName} ${user.lastName} (${user.role}) - Socket: ${socket.id}`);

        // Add user to online users
        addUserOnline(userId, socket.id);

        // Notify others that this user is online
        broadcastUserStatus(io, userId, true, user);

        // =============================================
        // SOCKET EVENT HANDLERS
        // =============================================

        /**
         * Join a conversation room
         * Users must join a room to receive messages from that conversation
         */
        socket.on("joinConversation", async (conversationId) => {
            try {
                // Verify user is part of this conversation
                const conversation = await Conversation.findOne({
                    _id: conversationId,
                    participants: userId
                });

                if (conversation) {
                    socket.join(`conversation:${conversationId}`);
                    console.log(`User ${userId} joined conversation ${conversationId}`);
                    
                    socket.emit("joinedConversation", { 
                        conversationId,
                        success: true 
                    });
                } else {
                    socket.emit("error", { 
                        message: "Not authorized to join this conversation" 
                    });
                }
            } catch (error) {
                console.error("Error joining conversation:", error);
                socket.emit("error", { message: "Failed to join conversation" });
            }
        });

        /**
         * Leave a conversation room
         */
        socket.on("leaveConversation", (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
            console.log(`User ${userId} left conversation ${conversationId}`);
        });

        /**
         * Send a message
         * This handles real-time message delivery
         */
        socket.on("sendMessage", async (data) => {
            try {
                const { conversationId, content, messageType = "text", dealDetails } = data;

                if (!conversationId || !content) {
                    socket.emit("error", { message: "Conversation ID and content are required" });
                    return;
                }

                // Verify user is part of this conversation
                const conversation = await Conversation.findOne({
                    _id: conversationId,
                    participants: userId
                });

                if (!conversation) {
                    socket.emit("error", { message: "Conversation not found" });
                    return;
                }

                // Find the receiver
                const receiverId = conversation.participants.find(
                    p => p.toString() !== userId
                );

                // Types that carry deal details
                const dealMessageTypes = ["deal_proposal", "closing_call", "closing_call_accepted", "deal_closed", "payment_shared", "payment_sent"];

                // Create message in database
                const message = await Message.create({
                    conversationId,
                    sender: userId,
                    receiver: receiverId,
                    content,
                    messageType,
                    dealDetails: dealMessageTypes.includes(messageType) ? dealDetails : undefined,
                    status: "sent"
                });

                // Update conversation
                conversation.lastMessage = message._id;
                conversation.lastMessageText = content;
                conversation.lastMessageAt = new Date();
                
                // Increment unread count for receiver
                const currentUnread = conversation.unreadCount.get(receiverId.toString()) || 0;
                conversation.unreadCount.set(receiverId.toString(), currentUnread + 1);
                await conversation.save();

                // Populate sender info
                await message.populate('sender', 'firstName lastName role');

                // Prepare message data
                const messageData = {
                    _id: message._id,
                    conversationId: message.conversationId,
                    sender: message.sender,
                    receiver: message.receiver,
                    content: message.content,
                    messageType: message.messageType,
                    dealDetails: message.dealDetails,
                    status: message.status,
                    isRead: message.isRead,
                    createdAt: message.createdAt
                };

                // Emit to the conversation room (both sender and receiver if online)
                io.to(`conversation:${conversationId}`).emit("receiveMessage", messageData);

                // Also emit to receiver's personal room (for notification purposes)
                const receiverSockets = onlineUsers.get(receiverId.toString());
                if (receiverSockets) {
                    receiverSockets.forEach(socketId => {
                        io.to(socketId).emit("newMessageNotification", {
                            conversationId,
                            message: messageData,
                            sender: message.sender
                        });
                    });

                    // Update message status to delivered
                    message.status = "delivered";
                    await message.save();

                    // Notify sender that message was delivered
                    socket.emit("messageDelivered", { 
                        messageId: message._id,
                        conversationId 
                    });
                }

                // Confirm to sender
                socket.emit("messageSent", { 
                    messageId: message._id,
                    conversationId,
                    status: message.status
                });

            } catch (error) {
                console.error("Error sending message:", error);
                socket.emit("error", { message: "Failed to send message" });
            }
        });

        /**
         * Mark messages as read
         */
        socket.on("markAsRead", async (data) => {
            try {
                const { conversationId } = data;

                const conversation = await Conversation.findOne({
                    _id: conversationId,
                    participants: userId
                });

                if (!conversation) return;

                // Get unread messages
                const unreadMessages = await Message.find({
                    conversationId,
                    receiver: userId,
                    isRead: false
                });

                // Update messages
                await Message.updateMany(
                    { conversationId, receiver: userId, isRead: false },
                    { isRead: true, readAt: new Date(), status: "read" }
                );

                // Reset unread count
                conversation.unreadCount.set(userId, 0);
                await conversation.save();

                // Notify senders that their messages were read
                const senderIds = [...new Set(unreadMessages.map(m => m.sender.toString()))];
                senderIds.forEach(senderId => {
                    const senderSockets = onlineUsers.get(senderId);
                    if (senderSockets) {
                        senderSockets.forEach(socketId => {
                            io.to(socketId).emit("messagesRead", {
                                conversationId,
                                readBy: userId,
                                readAt: new Date()
                            });
                        });
                    }
                });

            } catch (error) {
                console.error("Error marking messages as read:", error);
            }
        });

        /**
         * Typing indicator
         */
        socket.on("typing", (data) => {
            const { conversationId, isTyping } = data;
            socket.to(`conversation:${conversationId}`).emit("userTyping", {
                conversationId,
                userId,
                userName: `${user.firstName} ${user.lastName}`,
                isTyping
            });
        });

        /**
         * Get online status of specific users
         */
        socket.on("getOnlineStatus", (userIds) => {
            const statuses = {};
            userIds.forEach(id => {
                statuses[id] = isUserOnline(id);
            });
            socket.emit("onlineStatuses", statuses);
        });

        /**
         * Handle disconnection
         */
        socket.on("disconnect", (reason) => {
            console.log(`User disconnected: ${user.firstName} ${user.lastName} - Reason: ${reason}`);
            
            // Remove socket from online users
            removeUserOnline(userId, socket.id);

            // If user has no more active sockets, broadcast offline status
            if (!isUserOnline(userId)) {
                broadcastUserStatus(io, userId, false, user);
            }
        });

        /**
         * Handle reconnection
         */
        socket.on("reconnect", () => {
            console.log(`User reconnected: ${user.firstName} ${user.lastName}`);
            addUserOnline(userId, socket.id);
            broadcastUserStatus(io, userId, true, user);
        });
    });

    return io;
}

// =============================================
// HELPER FUNCTIONS
// =============================================

/**
 * Add user to online users map
 */
function addUserOnline(userId, socketId) {
    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socketId);
    socketToUser.set(socketId, userId);
}

/**
 * Remove user socket from online users map
 */
function removeUserOnline(userId, socketId) {
    const userSockets = onlineUsers.get(userId);
    if (userSockets) {
        userSockets.delete(socketId);
        if (userSockets.size === 0) {
            onlineUsers.delete(userId);
        }
    }
    socketToUser.delete(socketId);
}

/**
 * Check if user is online
 */
function isUserOnline(userId) {
    return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

/**
 * Broadcast user online/offline status
 */
function broadcastUserStatus(io, userId, isOnline, user) {
    io.emit(isOnline ? "userOnline" : "userOffline", {
        userId,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isOnline,
        lastSeen: new Date()
    });
}

/**
 * Get all online user IDs
 */
export function getOnlineUserIds() {
    return Array.from(onlineUsers.keys());
}

/**
 * Check if specific user is online
 */
export function checkUserOnline(userId) {
    return isUserOnline(userId);
}

/**
 * Get socket instance for emitting from controllers
 */
let ioInstance = null;

export function setIOInstance(io) {
    ioInstance = io;
}

export function getIOInstance() {
    return ioInstance;
}

/**
 * Emit event to specific user (utility function for controllers)
 */
export function emitToUser(userId, event, data) {
    if (!ioInstance) return false;
    
    const userSockets = onlineUsers.get(userId.toString());
    if (userSockets) {
        userSockets.forEach(socketId => {
            ioInstance.to(socketId).emit(event, data);
        });
        return true;
    }
    return false;
}

/**
 * Emit event to conversation room
 */
export function emitToConversation(conversationId, event, data) {
    if (!ioInstance) return false;
    ioInstance.to(`conversation:${conversationId}`).emit(event, data);
    return true;
}
