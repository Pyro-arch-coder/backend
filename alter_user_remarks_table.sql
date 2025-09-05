-- Modify the user_remarks table to allow admin_id to be NULL and add superadmin_id column
ALTER TABLE user_remarks MODIFY COLUMN admin_id INT NULL;

-- Add superadmin_id column
ALTER TABLE user_remarks ADD COLUMN superadmin_id INT NULL;

-- Add foreign key constraint for superadmin_id
ALTER TABLE user_remarks ADD CONSTRAINT user_remarks_ibfk_3 
FOREIGN KEY (superadmin_id) REFERENCES superadmin(id);

-- Add a check constraint to ensure either admin_id or superadmin_id is not NULL
ALTER TABLE user_remarks ADD CONSTRAINT check_admin_or_superadmin 
CHECK (admin_id IS NOT NULL OR superadmin_id IS NOT NULL);
