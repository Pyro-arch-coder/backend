-- Add display_name column to all document tables
ALTER TABLE psa_documents ADD COLUMN display_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE itr_documents ADD COLUMN display_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE med_cert_documents ADD COLUMN display_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE marriage_documents ADD COLUMN display_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE cenomar_documents ADD COLUMN display_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE death_cert_documents ADD COLUMN display_name VARCHAR(255) NOT NULL DEFAULT '';
