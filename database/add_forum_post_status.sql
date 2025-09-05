-- Add status column to forum_posts table
ALTER TABLE forum_posts
ADD COLUMN status ENUM('Pending', 'Verified', 'Declined', 'Deleted') NOT NULL DEFAULT 'Pending';

-- Add index for status column
CREATE INDEX idx_forum_posts_status ON forum_posts(status);
