-- PSA Documents Table
CREATE TABLE psa_documents (
    psa_id INT PRIMARY KEY AUTO_INCREMENT,
    code_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Uploaded', 'Pending', 'Approved', 'Rejected') DEFAULT 'Uploaded',
    rejection_reason TEXT,
    FOREIGN KEY (code_id) REFERENCES users(code_id) ON DELETE CASCADE,
    INDEX idx_code_id (code_id)
);

-- ITR Documents Table
CREATE TABLE itr_documents (
    itr_id INT PRIMARY KEY AUTO_INCREMENT,
    code_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Uploaded', 'Pending', 'Approved', 'Rejected') DEFAULT 'Uploaded',
    rejection_reason TEXT,
    FOREIGN KEY (code_id) REFERENCES users(code_id) ON DELETE CASCADE,
    INDEX idx_code_id (code_id)
);

-- Medical Certificate Documents Table
CREATE TABLE med_cert_documents (
    med_cert_id INT PRIMARY KEY AUTO_INCREMENT,
    code_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Uploaded', 'Pending', 'Approved', 'Rejected') DEFAULT 'Uploaded',
    rejection_reason TEXT,
    FOREIGN KEY (code_id) REFERENCES users(code_id) ON DELETE CASCADE,
    INDEX idx_code_id (code_id)
);

-- Marriage Documents Table
CREATE TABLE marriage_documents (
    marriage_id INT PRIMARY KEY AUTO_INCREMENT,
    code_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Uploaded', 'Pending', 'Approved', 'Rejected') DEFAULT 'Uploaded',
    rejection_reason TEXT,
    FOREIGN KEY (code_id) REFERENCES users(code_id) ON DELETE CASCADE,
    INDEX idx_code_id (code_id)
);

-- CENOMAR Documents Table
CREATE TABLE cenomar_documents (
    cenomar_id INT PRIMARY KEY AUTO_INCREMENT,
    code_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Uploaded', 'Pending', 'Approved', 'Rejected') DEFAULT 'Uploaded',
    rejection_reason TEXT,
    FOREIGN KEY (code_id) REFERENCES users(code_id) ON DELETE CASCADE,
    INDEX idx_code_id (code_id)
);

-- Death Certificate Documents Table
CREATE TABLE death_cert_documents (
    death_cert_id INT PRIMARY KEY AUTO_INCREMENT,
    code_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Uploaded', 'Pending', 'Approved', 'Rejected') DEFAULT 'Uploaded',
    rejection_reason TEXT,
    FOREIGN KEY (code_id) REFERENCES users(code_id) ON DELETE CASCADE,
    INDEX idx_code_id (code_id)
);
-- Barangay Certificate Documents Table
CREATE TABLE barangay_cert_documents (
    barangay_cert_id INT PRIMARY KEY AUTO_INCREMENT,
    code_id VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Uploaded', 'Pending', 'Approved', 'Rejected') DEFAULT 'Uploaded',
    rejection_reason TEXT,
    FOREIGN KEY (code_id) REFERENCES users(code_id) ON DELETE CASCADE,
    INDEX idx_code_id (code_id)
);

CREATE TABLE IF NOT EXISTS event_ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  rating INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_event_user (event_id, user_id)
);

