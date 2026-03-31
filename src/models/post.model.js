import mongoose from "mongoose";

// Reply schema for nested replies
const replySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    text: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Comment schema with replies
const commentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    text: {
        type: String,
        required: true
    },
    replies: [replySchema],
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const postSchema = new mongoose.Schema({
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    
    content: {
        type: String,
        required: true
    },
    
    images: [{
        type: String
    }],
    
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],
    
    comments: [commentSchema],
    
    shares: {
        type: Number,
        default: 0
    },
    
    category: {
        type: String,
        enum: ["general", "tip", "question", "news", "price-update"],
        default: "general"
    }
    
}, { timestamps: true });

export const Post = mongoose.model("Post", postSchema);
