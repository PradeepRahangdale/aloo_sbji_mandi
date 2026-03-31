import express from "express";
import { Post } from "../models/post.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = express.Router();

// Get all posts
router.get("/", async (req, res) => {
    try {
        const { category, limit = 20, page = 1 } = req.query;
        const query = {};
        
        if (category) query.category = category;
        
        const posts = await Post.find(query)
            .populate("author", "firstName lastName role")
            .populate("comments.user", "firstName lastName role")
            .populate("comments.replies.user", "firstName lastName role")
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        
        const total = await Post.countDocuments(query);
        
        res.status(200).json({
            success: true,
            data: {
                posts,
                total,
                page: parseInt(page),
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get single post
router.get("/:id", async (req, res) => {
    try {
        const post = await Post.findById(req.params.id)
            .populate("author", "firstName lastName role")
            .populate("comments.user", "firstName lastName role")
            .populate("comments.replies.user", "firstName lastName role");
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        res.status(200).json({ success: true, data: { post } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create post (protected)
router.post("/create", authMiddleware, async (req, res) => {
    try {
        const { content, category, images } = req.body;
        
        const post = await Post.create({
            author: req.user._id,
            content,
            category: category || "general",
            images: images || []
        });
        
        const populatedPost = await Post.findById(post._id)
            .populate("author", "firstName lastName role");
        
        res.status(201).json({
            success: true,
            message: "Post created successfully",
            data: { post: populatedPost }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Like/Unlike post (protected)
router.patch("/:id/like", authMiddleware, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        const userId = req.user._id;
        const isLiked = post.likes.includes(userId);
        
        if (isLiked) {
            post.likes = post.likes.filter(id => id.toString() !== userId.toString());
        } else {
            post.likes.push(userId);
        }
        
        await post.save();
        
        res.status(200).json({
            success: true,
            message: isLiked ? "Post unliked" : "Post liked",
            data: { likesCount: post.likes.length }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add comment (protected)
router.post("/:id/comment", authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text || text.trim() === '') {
            return res.status(400).json({ success: false, message: "Comment text is required" });
        }
        
        const post = await Post.findById(req.params.id);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        post.comments.push({
            user: req.user._id,
            text: text.trim(),
            replies: [],
            likes: []
        });
        
        await post.save();
        
        const updatedPost = await Post.findById(post._id)
            .populate("comments.user", "firstName lastName role")
            .populate("comments.replies.user", "firstName lastName role");
        
        res.status(200).json({
            success: true,
            message: "Comment added",
            data: { comments: updatedPost.comments }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add reply to a comment (protected)
router.post("/:postId/comment/:commentId/reply", authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        const { postId, commentId } = req.params;
        
        if (!text || text.trim() === '') {
            return res.status(400).json({ success: false, message: "Reply text is required" });
        }
        
        const post = await Post.findById(postId);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        const comment = post.comments.id(commentId);
        
        if (!comment) {
            return res.status(404).json({ success: false, message: "Comment not found" });
        }
        
        comment.replies.push({
            user: req.user._id,
            text: text.trim()
        });
        
        await post.save();
        
        const updatedPost = await Post.findById(postId)
            .populate("comments.user", "firstName lastName role")
            .populate("comments.replies.user", "firstName lastName role");
        
        const updatedComment = updatedPost.comments.id(commentId);
        
        res.status(200).json({
            success: true,
            message: "Reply added",
            data: { comment: updatedComment }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Like/Unlike a comment (protected)
router.patch("/:postId/comment/:commentId/like", authMiddleware, async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        
        const post = await Post.findById(postId);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        const comment = post.comments.id(commentId);
        
        if (!comment) {
            return res.status(404).json({ success: false, message: "Comment not found" });
        }
        
        const userId = req.user._id;
        const isLiked = comment.likes.some(id => id.toString() === userId.toString());
        
        if (isLiked) {
            comment.likes = comment.likes.filter(id => id.toString() !== userId.toString());
        } else {
            comment.likes.push(userId);
        }
        
        await post.save();
        
        res.status(200).json({
            success: true,
            message: isLiked ? "Comment unliked" : "Comment liked",
            data: { likesCount: comment.likes.length }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Track share (protected)
router.patch("/:id/share", authMiddleware, async (req, res) => {
    try {
        const post = await Post.findByIdAndUpdate(
            req.params.id,
            { $inc: { shares: 1 } },
            { new: true }
        );
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        res.status(200).json({
            success: true,
            message: "Share tracked",
            data: { shares: post.shares }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete comment (protected - only comment author)
router.delete("/:postId/comment/:commentId", authMiddleware, async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        
        const post = await Post.findById(postId);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        const comment = post.comments.id(commentId);
        
        if (!comment) {
            return res.status(404).json({ success: false, message: "Comment not found" });
        }
        
        if (comment.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized to delete this comment" });
        }
        
        post.comments.pull(commentId);
        await post.save();
        
        res.status(200).json({
            success: true,
            message: "Comment deleted"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update comment (protected - only comment author)
const updateCommentHandler = async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        const { text } = req.body;
        
        if (!text || text.trim() === '') {
            return res.status(400).json({ success: false, message: "Comment text is required" });
        }
        
        const post = await Post.findById(postId);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        const comment = post.comments.id(commentId);
        
        if (!comment) {
            return res.status(404).json({ success: false, message: "Comment not found" });
        }
        
        if (comment.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized to edit this comment" });
        }
        
        comment.text = text.trim();
        await post.save();
        
        res.status(200).json({
            success: true,
            message: "Comment updated"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Register update comment routes with multiple methods and paths
router.patch("/:postId/comment/:commentId", authMiddleware, updateCommentHandler);
router.put("/:postId/comment/:commentId", authMiddleware, updateCommentHandler);
router.post("/:postId/comment/:commentId", authMiddleware, updateCommentHandler);
router.patch("/:postId/comment/:commentId/update", authMiddleware, updateCommentHandler);
router.put("/:postId/comment/:commentId/update", authMiddleware, updateCommentHandler);
router.post("/:postId/comment/:commentId/update", authMiddleware, updateCommentHandler);

// Delete reply (protected - only reply author)
router.delete("/:postId/comment/:commentId/reply/:replyId", authMiddleware, async (req, res) => {
    try {
        const { postId, commentId, replyId } = req.params;
        
        const post = await Post.findById(postId);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        const comment = post.comments.id(commentId);
        
        if (!comment) {
            return res.status(404).json({ success: false, message: "Comment not found" });
        }
        
        const reply = comment.replies.id(replyId);
        
        if (!reply) {
            return res.status(404).json({ success: false, message: "Reply not found" });
        }
        
        if (reply.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized to delete this reply" });
        }
        
        comment.replies.pull(replyId);
        await post.save();
        
        res.status(200).json({
            success: true,
            message: "Reply deleted"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update reply (protected - only reply author)
const updateReplyHandler = async (req, res) => {
    try {
        const { postId, commentId, replyId } = req.params;
        const { text } = req.body;
        
        if (!text || text.trim() === '') {
            return res.status(400).json({ success: false, message: "Reply text is required" });
        }
        
        const post = await Post.findById(postId);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        const comment = post.comments.id(commentId);
        
        if (!comment) {
            return res.status(404).json({ success: false, message: "Comment not found" });
        }
        
        const reply = comment.replies.id(replyId);
        
        if (!reply) {
            return res.status(404).json({ success: false, message: "Reply not found" });
        }
        
        if (reply.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized to edit this reply" });
        }
        
        reply.text = text.trim();
        await post.save();
        
        res.status(200).json({
            success: true,
            message: "Reply updated"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Register update reply routes with multiple methods and paths
router.patch("/:postId/comment/:commentId/reply/:replyId", authMiddleware, updateReplyHandler);
router.put("/:postId/comment/:commentId/reply/:replyId", authMiddleware, updateReplyHandler);
router.post("/:postId/comment/:commentId/reply/:replyId", authMiddleware, updateReplyHandler);
router.patch("/:postId/comment/:commentId/reply/:replyId/update", authMiddleware, updateReplyHandler);
router.put("/:postId/comment/:commentId/reply/:replyId/update", authMiddleware, updateReplyHandler);
router.post("/:postId/comment/:commentId/reply/:replyId/update", authMiddleware, updateReplyHandler);

// Update post (protected - only author)
const updatePostHandler = async (req, res) => {
    try {
        const { content, category } = req.body;

        const post = await Post.findById(req.params.id);

        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }

        if (post.author.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized" });
        }

        if (typeof content === "string") {
            const trimmed = content.trim();
            if (!trimmed) {
                return res.status(400).json({ success: false, message: "Post content is required" });
            }
            post.content = trimmed;
        }

        if (typeof category === "string") {
            post.category = category;
        }

        await post.save();

        const updatedPost = await Post.findById(post._id)
            .populate("author", "firstName lastName role")
            .populate("comments.user", "firstName lastName role")
            .populate("comments.replies.user", "firstName lastName role");

        res.status(200).json({
            success: true,
            message: "Post updated",
            data: { post: updatedPost }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

router.patch("/:id", authMiddleware, updatePostHandler);
router.put("/:id", authMiddleware, updatePostHandler);
router.patch("/update/:id", authMiddleware, updatePostHandler);
router.put("/update/:id", authMiddleware, updatePostHandler);
router.post("/update/:id", authMiddleware, updatePostHandler);

// Delete post (protected - only author)
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        
        if (!post) {
            return res.status(404).json({ success: false, message: "Post not found" });
        }
        
        if (post.author.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized" });
        }
        
        await post.deleteOne();
        
        res.status(200).json({ success: true, message: "Post deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
