const mongoose = require('mongoose');

const forumCommentSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true
  },
  author: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ForumPost',
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// Update the timestamp before saving
forumCommentSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

const ForumComment = mongoose.model('ForumComment', forumCommentSchema);

module.exports = ForumComment;
