const express = require('express');
const router = express.Router();
const { pool, queryDatabase } = require('../database');

// Get all posts
router.get('/posts', async (req, res) => {
  try {
    const userId = req.query.userId; // Get userId from query params
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Get user's barangay from step1_identifying_information
    const userResult = await queryDatabase(`
      SELECT u.code_id, s.barangay 
      FROM users u
      LEFT JOIN step1_identifying_information s ON u.code_id = s.code_id
      WHERE u.id = ?
    `, [userId]);

    if (!userResult || userResult.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userBarangay = userResult[0].barangay;

    // Get posts with status Verified or if no status, treat as Verified (for backward compatibility)
    // Only show posts that match user's barangay or have visibility 'everyone'
    const posts = await queryDatabase(`
      SELECT p.id, p.title, p.content, p.created_at, p.status, p.visibility, p.barangay, p.user_id,
             COUNT(DISTINCT l.id) as likes,
             GROUP_CONCAT(DISTINCT l.user_id) as liked_by_users
      FROM forum_posts p
      LEFT JOIN forum_likes l ON p.id = l.post_id
      WHERE (p.status = 'Verified' OR p.status IS NULL)
      AND (p.visibility = 'everyone' OR p.barangay = ?)
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [userBarangay]);
    
    // Format the liked_by_users field for each post and set author to Anonymous
    posts.forEach(post => {
      post.liked_by_users = post.liked_by_users ? post.liked_by_users.split(',') : [];
      post.author = 'Anonymous';
    });
    
    console.log(`Returning ${posts.length} posts for user from barangay: ${userBarangay}`);
    res.json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get a specific post
router.get('/posts/:id', async (req, res) => {
  try {
    const [post] = await queryDatabase(`
      SELECT p.*, 
             COUNT(DISTINCT l.id) as likes,
             GROUP_CONCAT(DISTINCT l.user_id) as liked_by_users,
             u.profilePic
      FROM forum_posts p
      LEFT JOIN forum_likes l ON p.id = l.post_id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ? AND (p.status = 'Verified' OR p.status IS NULL)
      GROUP BY p.id
    `, [req.params.id]);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    // Format the liked_by_users field
    post.liked_by_users = post.liked_by_users ? post.liked_by_users.split(',') : [];
    
    res.json(post);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new post
router.post('/posts', async (req, res) => {
  try {
    const { title, content, author, user_id, visibility } = req.body;
    let postVisibility = visibility || 'everyone';
    let barangay = null;

    // If visibility is 'barangay', fetch the user's barangay from step1_identifying_information
    if (postVisibility === 'barangay') {
      // Get code_id from users table
      const userResult = await queryDatabase('SELECT code_id FROM users WHERE id = ?', [user_id]);
      const code_id = userResult[0]?.code_id || null;

      if (code_id) {
        // Get barangay from step1_identifying_information
        const step1Result = await queryDatabase('SELECT barangay FROM step1_identifying_information WHERE code_id = ?', [code_id]);
        barangay = step1Result[0]?.barangay || null;
      }
    }

    const result = await queryDatabase(
      'INSERT INTO forum_posts (title, content, author, user_id, status, visibility, barangay) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, content, author, user_id, 'Pending', postVisibility, barangay]
    );

    const newPost = await queryDatabase(
      'SELECT * FROM forum_posts WHERE id = ?',
      [result.insertId]
    );

    // Get user's full name from step1_identifying_information
    const userDetailsResult = await queryDatabase(`
      SELECT s1.first_name, s1.middle_name, s1.last_name, s1.suffix
      FROM users u
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.id = ?
    `, [user_id]);

    if (userDetailsResult && userDetailsResult.length > 0) {
      const userData = userDetailsResult[0];
      const fullName = `${userData.first_name || ''} ${userData.middle_name || ''} ${userData.last_name || ''}${userData.suffix && userData.suffix !== 'none' ? ` ${userData.suffix}` : ''}`.trim().replace(/\s+/g, ' ');
      
      // Insert notification for superadmin
      await queryDatabase(
        `INSERT INTO superadminnotifications (user_id, notif_type, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())`,
        [user_id, 'forum_post', `${fullName} has created a new forum post`]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Post created successfully. Waiting for admin approval.',
      post: newPost[0]
    });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ success: false, error: 'Failed to create post' });
  }
});

// Like a post
router.post('/posts/:id/like', async (req, res) => {
  try {
    const { userId } = req.body;
    const postId = req.params.id;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    
    // Check if the post exists
    const [post] = await queryDatabase(`
      SELECT * FROM forum_posts WHERE id = ? AND (status = 'Verified' OR status IS NULL)
    `, [postId]);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    // Check if user already liked the post
    const [existingLike] = await queryDatabase(`
      SELECT * FROM forum_likes WHERE post_id = ? AND user_id = ?
    `, [postId, userId]);
    
    if (existingLike) {
      // Unlike the post
      await queryDatabase(`
        DELETE FROM forum_likes WHERE post_id = ? AND user_id = ?
      `, [postId, userId]);
    } else {
      // Like the post
      await queryDatabase(`
        INSERT INTO forum_likes (post_id, user_id, created_at)
        VALUES (?, ?, NOW())
      `, [postId, userId]);
    }
    
    // Get updated post with likes count
    const [updatedPost] = await queryDatabase(`
      SELECT p.*, 
             COUNT(DISTINCT l.id) as likes,
             GROUP_CONCAT(DISTINCT l.user_id) as liked_by_users,
             u.profilePic
      FROM forum_posts p
      LEFT JOIN forum_likes l ON p.id = l.post_id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.id = ? AND (p.status = 'Verified' OR p.status IS NULL)
      GROUP BY p.id
    `, [postId]);
    
    // Format the liked_by_users field
    updatedPost.liked_by_users = updatedPost.liked_by_users ? updatedPost.liked_by_users.split(',') : [];
    
    res.json(updatedPost);
  } catch (error) {
    console.error('Error liking post:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get comments for a post
router.get('/posts/:id/comments', async (req, res) => {
  try {
    const postId = req.params.id;
    console.log(`Fetching comments for post ${postId}`);
    
    // Check if the post ID is a temporary ID (client-side generated)
    if (postId.toString().startsWith('temp-')) {
      console.log(`Temporary post ID detected: ${postId}`);
      return res.status(404).json({ 
        message: 'Cannot fetch comments for temporary posts' 
      });
    }
    
    // First check if the post exists and is accessible
    const [post] = await queryDatabase(`
      SELECT * FROM forum_posts WHERE id = ?
    `, [postId]);
    
    if (!post) {
      console.log(`Post not found: ${postId}`);
      return res.status(404).json({ message: 'Post not found' });
    }
    
    // For admin endpoints, we'll allow viewing comments on any post regardless of status
    // For regular users, only show comments on verified posts
    const isAdminRequest = req.path.includes('/admin/');
    if (!isAdminRequest && post.status !== 'Verified' && post.status !== null) {
      console.log(`Post ${postId} has status ${post.status}, not accessible to regular users`);
      return res.status(403).json({ message: 'Post is not accessible' });
    }
    
    const comments = await queryDatabase(`
      SELECT c.*, u.profilePic as authorProfilePic
      FROM forum_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [postId]);
    
    // Log comment data for debugging
    console.log(`Returning ${comments.length} comments for post ${postId}`);
    
    // Always return the comments array, even if empty
    res.json(comments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a comment to a post
router.post('/posts/:id/comments', async (req, res) => {
  try {
    const { content, userId, author } = req.body;
    const postId = req.params.id;
    
    if (!content || !userId || !postId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    const [post] = await queryDatabase(`
      SELECT * FROM forum_posts WHERE id = ? AND (status = 'Verified' OR status IS NULL)
    `, [postId]);
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    const result = await queryDatabase(`
      INSERT INTO forum_comments (content, author, user_id, post_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
    `, [content, author, userId, postId]);
    
    // Get the new comment with user profile image
    const [newComment] = await queryDatabase(`
      SELECT c.*, u.profilePic as authorProfilePic
      FROM forum_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [result.insertId]);
    
    res.status(201).json(newComment);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a post (admin/superadmin can delete any post)
router.delete('/posts/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    // No userId check, allow admin/superadmin to delete any post

    // Start a transaction
    await queryDatabase('START TRANSACTION');
    try {
      // Delete all comments for the post
      await queryDatabase(`DELETE FROM forum_comments WHERE post_id = ?`, [postId]);
      // Delete all likes for the post
      await queryDatabase(`DELETE FROM forum_likes WHERE post_id = ?`, [postId]);
      // Delete the post
      await queryDatabase(`DELETE FROM forum_posts WHERE id = ?`, [postId]);
      // Commit the transaction
      await queryDatabase('COMMIT');
      res.json({ message: 'Post and related data deleted successfully' });
    } catch (error) {
      await queryDatabase('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update post status
router.put('/posts/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Validate status input
    const validStatuses = ['Pending', 'Verified', 'Declined', 'Deleted'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    // Get post details to get user_id
    const [post] = await queryDatabase(
      `SELECT user_id FROM forum_posts WHERE id = ?`,
      [id]
    );
    
    // Update post status
    await queryDatabase(
      `UPDATE forum_posts SET status = ? WHERE id = ?`,
      [status, id]
    );

    // Insert notification based on status
    if (status === 'Verified') {
      await queryDatabase(
        `INSERT INTO accepted_forums (user_id, accepted_at, message, is_read) 
         VALUES (?, NOW(), ?, false)`,
        [post.user_id, 'Your post has been accepted']
      );
    } else if (status === 'Declined') {
      await queryDatabase(
        `INSERT INTO accepted_forums (user_id, accepted_at, message, is_read) 
         VALUES (?, NOW(), ?, false)`,
        [post.user_id, 'Your post has been declined']
      );
    }
    
    // Return updated post
    const [updatedPost] = await queryDatabase(
      `SELECT * FROM forum_posts WHERE id = ?`,
      [id]
    );
    
    res.json(updatedPost);
  } catch (error) {
    console.error('Error updating post status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin endpoint to get all posts including pending ones
router.get('/admin/posts', async (req, res) => {
  try {
    const posts = await queryDatabase(`
      SELECT p.*, 
             COUNT(DISTINCT l.id) as likes,
             GROUP_CONCAT(DISTINCT l.user_id) as liked_by_users,
             u.profilePic
      FROM forum_posts p
      LEFT JOIN forum_likes l ON p.id = l.post_id
      LEFT JOIN users u ON p.user_id = u.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    
    // Format the liked_by_users field for each post
    posts.forEach(post => {
      post.liked_by_users = post.liked_by_users ? post.liked_by_users.split(',') : [];
    });
    
    res.json(posts);
  } catch (error) {
    console.error('Error fetching admin posts:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin endpoint to get comments for a post (regardless of post status)
router.get('/admin/posts/:id/comments', async (req, res) => {
  try {
    const postId = req.params.id;
    console.log(`Admin fetching comments for post ${postId}`);
    
    // Check if the post ID is a temporary ID
    if (postId.toString().startsWith('temp-')) {
      console.log(`Temporary post ID detected: ${postId}`);
      return res.status(404).json({ 
        message: 'Cannot fetch comments for temporary posts' 
      });
    }
    
    // First check if the post exists
    const [post] = await queryDatabase(`
      SELECT * FROM forum_posts WHERE id = ?
    `, [postId]);
    
    if (!post) {
      console.log(`Post not found: ${postId}`);
      return res.status(404).json({ message: 'Post not found' });
    }
    
    const comments = await queryDatabase(`
      SELECT c.*, u.profilePic as authorProfilePic
      FROM forum_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `, [postId]);
    
    console.log(`Admin: Returning ${comments.length} comments for post ${postId}`);
    
    // Always return the comments array, even if empty
    res.json(comments);
  } catch (error) {
    console.error('Error fetching admin comments:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get forum notifications for a user
router.get('/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const notifications = await queryDatabase(`
      SELECT * FROM accepted_forums 
      WHERE user_id = ? 
      ORDER BY accepted_at DESC
    `, [userId]);
    
    res.json(notifications);
  } catch (error) {
    console.error('Error fetching forum notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark forum notification as read
router.put('/notifications/mark-as-read/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    await queryDatabase(`
      UPDATE accepted_forums 
      SET is_read = true 
      WHERE id = ?
    `, [notificationId]);
    
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking forum notification as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a comment by ID
router.delete('/comments/:id', async (req, res) => {
  try {
    const commentId = req.params.id;
    const result = await queryDatabase('DELETE FROM forum_comments WHERE id = ?', [commentId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
