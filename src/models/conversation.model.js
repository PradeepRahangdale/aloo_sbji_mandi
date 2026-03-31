import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
    // Participants in the conversation (2 users)
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    }],

    // Last message for preview
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message"
    },

    // Last message text for quick preview
    lastMessageText: {
        type: String,
        default: ""
    },

    // Last message timestamp
    lastMessageAt: {
        type: Date,
        default: Date.now
    },

    // Unread count per participant
    unreadCount: {
        type: Map,
        of: Number,
        default: {}
    },

    // Conversation type
    type: {
        type: String,
        enum: ["direct", "listing", "booking", "cold-storage"],
        default: "direct"
    },

    // =============================================
    // CONTEXT LINKING - Links conversation to specific entity
    // =============================================
    
    // Context type: what this conversation is about
    contextType: {
        type: String,
        enum: ["none", "listing", "booking", "cold-storage", "trader-request"],
        default: "none"
    },

    // Context ID: the ID of the linked entity
    contextId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'contextModel'
    },

    // Dynamic reference based on context type
    contextModel: {
        type: String,
        enum: ["Listing", "Booking", "ColdStorage", "TraderRequest"]
    },

    // Context details for quick access
    contextDetails: {
        title: String,          // e.g., "Potato Listing - 500kg"
        price: Number,          // e.g., 40 (per kg)
        quantity: Number,       // e.g., 500
        unit: String,           // e.g., "kg"
        imageUrl: String        // Preview image
    },

    // Whether conversation is active
    isActive: {
        type: Boolean,
        default: true
    }

}, { timestamps: true });

// Index for fast lookup by participants
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });
// Compound index for context-based lookups
conversationSchema.index({ participants: 1, contextType: 1, contextId: 1 });

// Static method to find or create conversation between two users
conversationSchema.statics.findOrCreateConversation = async function(userId1, userId2, contextOptions = {}) {
    const { contextType = "none", contextId = null, contextModel = null, contextDetails = null } = contextOptions;
    
    // Build query
    let query = {
        participants: { $all: [userId1, userId2] },
    };
    
    // If context is provided, include it in search
    if (contextType !== "none" && contextId) {
        query.contextType = contextType;
        query.contextId = contextId;
    } else {
        // For direct chats without context, ensure we find one without context
        query.contextType = "none";
    }

    let conversation = await this.findOne(query)
        .populate('participants', 'firstName lastName role phone');

    if (!conversation) {
        const conversationData = {
            participants: [userId1, userId2],
            unreadCount: new Map([[userId1.toString(), 0], [userId2.toString(), 0]]),
            type: contextType === "none" ? "direct" : contextType,
            contextType,
        };

        // Add context if provided
        if (contextId) {
            conversationData.contextId = contextId;
            conversationData.contextModel = contextModel;
        }
        if (contextDetails) {
            conversationData.contextDetails = contextDetails;
        }

        conversation = await this.create(conversationData);
        conversation = await conversation.populate('participants', 'firstName lastName role phone');
    }

    return conversation;
};

export const Conversation = mongoose.model("Conversation", conversationSchema);
