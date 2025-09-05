-- Add unique constraint to email field in step1_identifying_information table
ALTER TABLE step1_identifying_information ADD UNIQUE INDEX unique_email_idx (email);

-- Add helpful comments for logging
INSERT INTO system_logs (message, timestamp) 
VALUES ('Added unique constraint to email field in step1_identifying_information table', NOW()); 