// Script to create forum tables in MySQL database
const { queryDatabase } = require('./database');

async function setupForumTables() {
  try {
    console.log('Setting up forum tables...');

    // Create forum_posts table
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS forum_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        author VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (created_at)
      )
    `);
    console.log('forum_posts table created or already exists');

    // Create forum_comments table
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS forum_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        content TEXT NOT NULL,
        author VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        post_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (post_id)
      )
    `);
    console.log('forum_comments table created or already exists');

    // Create forum_likes table
    await queryDatabase(`
      CREATE TABLE IF NOT EXISTS forum_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        post_id INT NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_like (post_id, user_id),
        INDEX (user_id)
      )
    `);
    console.log('forum_likes table created or already exists');

    console.log('All forum tables have been set up successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error setting up forum tables:', error);
    process.exit(1);
  }
}

// Run the setup function
setupForumTables();
