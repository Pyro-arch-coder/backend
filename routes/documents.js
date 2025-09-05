const express = require('express');
const router = express.Router();
const { queryDatabase, upsertDocument, deleteDocument, getUserDocuments } = require('../database');
const { pool } = require('../database');

// Map frontend document types to database table names and their ID columns
const TABLE_NAMES = {
  'psa': { table: 'psa_documents', idColumn: 'psa_id' },
  'itr': { table: 'itr_documents', idColumn: 'itr_id' },
  'med_cert': { table: 'med_cert_documents', idColumn: 'med_cert_id' },
  'marriage': { table: 'marriage_documents', idColumn: 'marriage_id' },
  'cenomar': { table: 'cenomar_documents', idColumn: 'cenomar_id' },
  'death_cert': { table: 'death_cert_documents', idColumn: 'death_cert_id' },
  'barangay_cert': { table: 'barangay_cert_documents', idColumn: 'barangay_cert_id' }
};

// Update user document
router.post('/updateUserDocument', async (req, res) => {
  let connection;
  try {
    const { userId, documentType, documentUrl, displayName } = req.body;
    console.log('Received document update request:', req.body);
    
    if (!userId || !documentType || !documentUrl || !displayName) {
      console.error('Missing required fields:', { userId, documentType, documentUrl, displayName });
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          userId: !userId ? 'missing' : 'present',
          documentType: !documentType ? 'missing' : 'present',
          documentUrl: !documentUrl ? 'missing' : 'present',
          displayName: !displayName ? 'missing' : 'present'
        }
      });
    }
    
    // Get connection and start transaction
    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Get the user's code_id and civil status first
    const userQuery = 'SELECT code_id, civil_status FROM users WHERE id = ?';
    console.log('Executing user query:', userQuery, 'with userId:', userId);
    const userResult = await new Promise((resolve, reject) => {
      connection.query(userQuery, [userId], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    console.log('User query result:', userResult);
    
    if (!userResult || userResult.length === 0) {
      console.error('User not found:', userId);
      throw new Error(`User with ID ${userId} not found`);
    }

    const code_id = userResult[0].code_id;
    const civil_status = userResult[0].civil_status;
    console.log('Found code_id:', code_id, 'civil_status:', civil_status);

    // Validate table name
    const tableInfo = TABLE_NAMES[documentType];
    if (!tableInfo) {
      console.error('Invalid document type:', documentType);
      throw new Error(`Invalid document type: ${documentType}`);
    }

    // Check if document already exists
    const checkDocQuery = `SELECT ${tableInfo.idColumn} FROM ${tableInfo.table} WHERE code_id = ? LIMIT 1`;
    const existingDoc = await new Promise((resolve, reject) => {
      connection.query(checkDocQuery, [code_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    console.log('Existing document check:', existingDoc);

    let result;
    if (existingDoc && existingDoc.length > 0) {
      // Update existing document
      console.log(`Document already exists for ${documentType}, updating instead of inserting`);
      const updateQuery = `
        UPDATE ${tableInfo.table} 
        SET file_name = ?, uploaded_at = ?, display_name = ?, status = ?
        WHERE code_id = ?`;
      result = await new Promise((resolve, reject) => {
        connection.query(updateQuery, [documentUrl, new Date(), displayName, 'Submitted', code_id], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log('Document update result:', result);
    } else {
      // Insert new document
      const insertQuery = `
        INSERT INTO ${tableInfo.table} (code_id, file_name, uploaded_at, display_name, status)
        VALUES (?, ?, ?, ?, ?)`;
      result = await new Promise((resolve, reject) => {
        connection.query(insertQuery, [code_id, documentUrl, new Date(), displayName, 'Submitted'], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log('Document insert result:', result);
    }

    // Check if all required documents are submitted
    const requiredDocuments = getRequiredDocumentsByCivilStatus(civil_status);
    console.log('Required documents for civil status:', civil_status, ':', requiredDocuments);

    let allDocumentsSubmitted = true;
    for (const docType of requiredDocuments) {
      const docTableInfo = TABLE_NAMES[docType];
      const checkDocQuery = `SELECT ${docTableInfo.idColumn} FROM ${docTableInfo.table} WHERE code_id = ? AND status = 'Submitted' LIMIT 1`;
      const docResult = await new Promise((resolve, reject) => {
        connection.query(checkDocQuery, [code_id], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      
      if (!docResult || docResult.length === 0) {
        allDocumentsSubmitted = false;
        break;
      }
    }

    // If all documents are submitted, update user status to 'Verified'
    if (allDocumentsSubmitted) {
      console.log('All required documents submitted, updating user status to Verified');
      const updateStatusQuery = `UPDATE users SET status = 'Verified' WHERE code_id = ?`;
      await new Promise((resolve, reject) => {
        connection.query(updateStatusQuery, [code_id], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    }

    // Commit the transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) {
          connection.rollback(() => reject(err));
        } else {
          resolve();
        }
      });
    });

    res.json({ 
      success: true, 
      message: existingDoc.length > 0 ? 'Document updated successfully' : 'Document inserted successfully',
      documentId: result.insertId || existingDoc[0]?.[tableInfo.idColumn],
      statusUpdated: allDocumentsSubmitted
    });
  } catch (error) {
    console.error('Error updating document:', error);
    
    // Rollback transaction if there was an error
    if (connection) {
      await new Promise(resolve => {
        connection.rollback(() => resolve());
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update document',
      details: error.message 
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Helper function to get required documents based on civil status
function getRequiredDocumentsByCivilStatus(civil_status) {
  const baseDocuments = ['psa', 'itr', 'med_cert'];
  
  switch (civil_status?.toLowerCase()) {
    case 'single':
      return [...baseDocuments, 'cenomar'];
    case 'married':
      return [...baseDocuments, 'marriage'];
    case 'divorced':
      return [...baseDocuments, 'marriage'];
    case 'widowed':
      return [...baseDocuments, 'marriage', 'death_cert'];
    default:
      return baseDocuments;
  }
}

// Get all documents for a user
router.get('/getUserDocuments/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('Fetching documents for userId:', userId);

    // Get user's code_id
    const userQuery = 'SELECT code_id FROM users WHERE id = ?';
    console.log('Executing user query:', userQuery, 'with userId:', userId);
    const userResult = await queryDatabase(userQuery, [userId]);
    console.log('User query result:', userResult);
    
    if (!userResult || userResult.length === 0) {
      console.error('User not found:', userId);
      return res.status(404).json({ error: `User with ID ${userId} not found` });
    }

    const code_id = userResult[0].code_id;
    console.log('Found code_id:', code_id);

    // Get all documents for the user
    const documents = await getUserDocuments(code_id);
    console.log('Retrieved documents:', documents);

    res.json({ success: true, documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Failed to fetch documents', details: error.message });
  }
});

// Delete document
router.post('/deleteDocument', async (req, res) => {
  try {
    const { userId, documentType } = req.body;
    console.log('Received delete request:', req.body);
    
    if (!userId || !documentType) {
      console.error('Missing required fields:', { userId, documentType });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get the user's code_id first
    const userQuery = 'SELECT code_id FROM users WHERE id = ?';
    console.log('Executing user query:', userQuery, 'with userId:', userId);
    const userResult = await queryDatabase(userQuery, [userId]);
    console.log('User query result:', userResult);
    
    if (!userResult || userResult.length === 0) {
      console.error('User not found:', userId);
      return res.status(404).json({ error: `User with ID ${userId} not found` });
    }

    const code_id = userResult[0].code_id;
    console.log('Found code_id:', code_id);

    // Validate table name
    const tableName = TABLE_NAMES[documentType];
    if (!tableName) {
      console.error('Invalid document type:', documentType);
      return res.status(400).json({ error: `Invalid document type: ${documentType}` });
    }

    // Delete from database
    const result = await deleteDocument(tableName.table, code_id);
    console.log('Delete result:', result);

    res.json({ 
      success: true, 
      message: 'Document deleted successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document', details: error.message });
  }
});

// Submit all steps
router.post('/submitAllSteps', async (req, res) => {
  let connection;
  try {
    const { step1, step2, step3, step4, step5, step6 } = req.body;
    console.log('Received all steps data:', req.body);
    console.log('Step 6 data:', step6);
    
    // Get connection and start transaction
    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });
    
    // Use the strongest transaction isolation level
    await new Promise((resolve, reject) => {
      connection.query("SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // First, check if an entry with this email already exists
    const timestamp = Date.now();
    console.log(`[${timestamp}] Checking for existing email: ${step1.email}`);

    // Check user by email in users table
    const userCheckQuery = `SELECT * FROM users WHERE email = ? LIMIT 1`;
    const existingUser = await new Promise((resolve, reject) => {
      connection.query(userCheckQuery, [step1.email], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    if (existingUser && existingUser.length > 0) {
      const user = existingUser[0];
      if (user.status === 'Declined') {
        // Allow update of all steps and user info, set status to 'Pending'
        const code_id = user.code_id;
        console.log(`[${timestamp}] Resubmitting for Declined user, code_id: ${code_id}`);
        try {
          // Step 1: Update identifying information
          const updateStep1Query = `UPDATE step1_identifying_information SET
            first_name=?, middle_name=?, last_name=?, age=?, gender=?,
            date_of_birth=?, place_of_birth=?, barangay=?, education=?,
            civil_status=?, occupation=?, religion=?, company=?, income=?,
            employment_status=?, contact_number=?, pantawid_beneficiary=?, indigenous=?, suffix=?
            WHERE code_id=?`;
          await new Promise((resolve, reject) => {
            connection.query(updateStep1Query, [
              step1.first_name,
              step1.middle_name,
              step1.last_name,
              step1.age,
              step1.gender,
              step1.date_of_birth,
              step1.place_of_birth,
              step1.barangay,
              step1.education,
              step1.civil_status,
              step1.occupation,
              step1.religion,
              step1.company,
              step1.income,
              step1.employment_status,
              step1.contact_number,
              step1.pantawid_beneficiary,
              step1.indigenous,
              step1.suffix || 'none',
              code_id
            ], (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });

          // Step 2: Remove old children and insert new
          await new Promise((resolve, reject) => {
            connection.query('DELETE FROM step2_family_occupation WHERE code_id=?', [code_id], (err) => {
              if (err) reject(err); else resolve();
            });
          });
          if (step2.children && step2.children.length > 0) {
            const childrenQuery = `INSERT INTO step2_family_occupation (code_id, family_member_name, age, educational_attainment, birthdate) VALUES ?`;
            const childrenValues = step2.children.map(child => [
              code_id,
              `${child.first_name} ${child.middle_name} ${child.last_name}${child.suffix ? ` ${child.suffix}` : ''}`.trim(),
              child.age,
              child.educational_attainment,
              child.birthdate
            ]);
            await new Promise((resolve, reject) => {
              connection.query(childrenQuery, [childrenValues], (err, result) => {
                if (err) reject(err); else resolve(result);
              });
            });
          }

          // Step 3: Update classification
          await new Promise((resolve, reject) => {
            connection.query('UPDATE step3_classification SET classification=? WHERE code_id=?', [step3.classification, code_id], (err, result) => {
              if (err) reject(err); else resolve(result);
            });
          });

          // Step 4: Update needs/problems
          await new Promise((resolve, reject) => {
            connection.query('UPDATE step4_needs_problems SET needs_problems=? WHERE code_id=?', [step4.needs_problems, code_id], (err, result) => {
              if (err) reject(err); else resolve(result);
            });
          });

          // Step 5: Update emergency contact
          await new Promise((resolve, reject) => {
            connection.query('UPDATE step5_in_case_of_emergency SET emergency_name=?, emergency_relationship=?, emergency_address=?, emergency_contact=? WHERE code_id=?', [
              step5.emergency_name,
              step5.emergency_relationship,
              step5.emergency_address,
              step5.emergency_contact,
              code_id
            ], (err, result) => {
              if (err) reject(err); else resolve(result);
            });
          });

          // Step 6: Update faceRecognitionPhoto and set status to 'Pending'
          await new Promise((resolve, reject) => {
            connection.query('UPDATE users SET status=?, faceRecognitionPhoto=?, name=?, password=? WHERE id=?', [
              'Pending',
              step6?.faceRecognitionPhoto || null,
              `${step1.first_name} ${step1.middle_name || ''} ${step1.last_name}`.trim().replace(/\s+/g, ' '),
              step1.date_of_birth,
              user.id
            ], (err, result) => {
              if (err) reject(err); else resolve(result);
            });
          });

          // Commit transaction
          await new Promise((resolve, reject) => {
            connection.commit(err => {
              if (err) return connection.rollback(() => reject(err));
              resolve();
            });
          });

          // Insert notification for superadmin
          try {
            await new Promise((resolve, reject) => {
              connection.query(
                `INSERT INTO superadminnotifications (user_id, notif_type, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())`,
                [user.id, 'new_app', 'New application was re-submitted'],
                (err, result) => { if (err) reject(err); else resolve(result); }
              );
            });
          } catch (notifError) { console.error('Error inserting superadmin notification:', notifError); }

          res.json({
            success: true,
            message: 'Resubmission successful. Application updated.',
            code_id: code_id,
            resubmitted: true
          });
          return;
        } catch (innerError) {
          console.error(`[${timestamp}] Error during resubmission:`, innerError);
          await new Promise((resolve) => connection.rollback(() => resolve()));
          throw innerError;
        }
      } else {
        // Email exists and not declined, block submission
        await new Promise((resolve) => connection.rollback(() => resolve()));
        connection.release();
        return res.status(400).json({
          success: false,
          error: 'Email already registered',
          details: `A form with email ${step1.email} has already been submitted and is not declined.`,
          existing_code_id: user.code_id
        });
      }
    }
    // If user does not exist, proceed with normal insert below


    // Generate a code_id with the format XXXX_XX_XXXXXX
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    // Generate a random 6-digit number for the last part
    const randomDigits = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const code_id = `${year}_${month}_${randomDigits}`;
    console.log(`[${timestamp}] Generated code_id: ${code_id}`);
    console.log(`[${timestamp}] Starting transaction with code_id: ${code_id}`);

    try {
      // Step 1: Insert identifying information
      console.log(`[${timestamp}] Inserting step 1...`);
      const step1Query = `
        INSERT INTO step1_identifying_information (
          code_id, first_name, middle_name, last_name, age, gender,
          date_of_birth, place_of_birth, barangay, education,
          civil_status, occupation, religion, company, income,
          employment_status, contact_number, email,
          pantawid_beneficiary, indigenous, suffix
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await new Promise((resolve, reject) => {
        connection.query(step1Query, [
          code_id,
          step1.first_name,
          step1.middle_name,
          step1.last_name,
          step1.age,
          step1.gender,
          step1.date_of_birth,
          step1.place_of_birth,
          step1.barangay,
          step1.education,
          step1.civil_status,
          step1.occupation,
          step1.religion,
          step1.company,
          step1.income,
          step1.employment_status,
          step1.contact_number,
          step1.email,
          step1.pantawid_beneficiary,
          step1.indigenous,
          step1.suffix || 'none'
        ], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log(`[${timestamp}] Step 1 inserted`);

      // Step 2: Insert children information
      console.log(`[${timestamp}] Inserting step 2...`);
      if (step2.children && step2.children.length > 0) {
        const childrenQuery = `
          INSERT INTO step2_family_occupation (
            code_id, family_member_name, age, educational_attainment, birthdate
          ) VALUES ?
        `;
        const childrenValues = step2.children.map(child => [
          code_id,
          `${child.first_name} ${child.middle_name} ${child.last_name}${child.suffix ? ` ${child.suffix}` : ''}`.trim(),
          child.age,
          child.educational_attainment,
          child.birthdate
        ]);
        
        await new Promise((resolve, reject) => {
          connection.query(childrenQuery, [childrenValues], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        console.log(`[${timestamp}] Step 2 inserted`);
      } else {
        console.log(`[${timestamp}] No children to insert for step 2`);
      }

      // Step 3: Insert classification
      console.log(`[${timestamp}] Inserting step 3...`);
      const step3Query = `
        INSERT INTO step3_classification (
          code_id, classification
        ) VALUES (?, ?)
      `;
      await new Promise((resolve, reject) => {
        connection.query(step3Query, [
          code_id,
          step3.classification
        ], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log(`[${timestamp}] Step 3 inserted`);

      // Step 4: Insert needs/problems
      console.log(`[${timestamp}] Inserting step 4...`);
      const step4Query = `
        INSERT INTO step4_needs_problems (
          code_id, needs_problems
        ) VALUES (?, ?)
      `;
      await new Promise((resolve, reject) => {
        connection.query(step4Query, [
          code_id,
          step4.needs_problems
        ], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log(`[${timestamp}] Step 4 inserted`);

      // Step 5: Insert emergency contact
      console.log(`[${timestamp}] Inserting step 5...`);
      const step5Query = `
        INSERT INTO step5_in_case_of_emergency (
          code_id, emergency_name, emergency_relationship,
          emergency_address, emergency_contact
        ) VALUES (?, ?, ?, ?, ?)
      `;
      await new Promise((resolve, reject) => {
        connection.query(step5Query, [
          code_id,
          step5.emergency_name,
          step5.emergency_relationship,
          step5.emergency_address,
          step5.emergency_contact
        ], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log(`[${timestamp}] Step 5 inserted`);

      // Create user account in the same transaction
      console.log(`[${timestamp}] Creating user account...`);
      console.log(`[${timestamp}] Face recognition photo URL:`, step6?.faceRecognitionPhoto);
      
      // First check if user with this email already exists
      const checkEmailQuery = `SELECT id, email FROM users WHERE email = ? LIMIT 1`;
      const existingUser = await new Promise((resolve, reject) => {
        connection.query(checkEmailQuery, [step1.email], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      
      // Create name by combining first, middle and last names
      const fullName = `${step1.first_name} ${step1.middle_name || ''} ${step1.last_name}${step1.suffix && step1.suffix !== 'none' ? ` ${step1.suffix}` : ''}`.trim().replace(/\s+/g, ' ');
      
      // Use the birthdate as the password
      const password = step1.date_of_birth;
      
      if (existingUser && existingUser.length > 0) {
        // If user already exists, update their code_id and faceRecognitionPhoto
        console.log(`[${timestamp}] User with email ${step1.email} already exists, updating code_id and faceRecognitionPhoto`);
        const updateQuery = `UPDATE users SET code_id = ?, faceRecognitionPhoto = ? WHERE id = ?`;
        await new Promise((resolve, reject) => {
          connection.query(updateQuery, [code_id, step6?.faceRecognitionPhoto || null, existingUser[0].id], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        console.log(`[${timestamp}] Updated existing user with new code_id and faceRecognitionPhoto`);
      } else {
        // If user doesn't exist, create new user with faceRecognitionPhoto
        console.log(`[${timestamp}] Creating new user with email ${step1.email}`);
        const userQuery = `
          INSERT INTO users (
            email, code_id, status, name, password, faceRecognitionPhoto
          ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const newUserResult = await new Promise((resolve, reject) => {
          connection.query(userQuery, [
            step1.email, 
            code_id, 
            'Pending',
            fullName,
            password,
            step6?.faceRecognitionPhoto || null
          ], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        // Add notification for new application (admin notification)
        try {
          await new Promise((resolve, reject) => {
            connection.query(
              `INSERT INTO adminnotifications (user_id, notif_type, message, barangay, is_read, created_at) VALUES (?, ?, ?, ?, 0, NOW())`,
              [newUserResult.insertId, 'new_app', 'New application was created', step1.barangay],
              (err, result) => { if (err) reject(err); else resolve(result); }
            );
          });
        } catch (notifError) { 
          console.error('Error inserting admin notification:', notifError); 
        }

        console.log(`[${timestamp}] User account created with password set to birthdate and faceRecognitionPhoto`);
      }

      // Commit transaction only after all operations succeed
      await new Promise((resolve, reject) => {
        connection.commit(err => {
          if (err) {
            console.error(`[${timestamp}] Error committing transaction:`, err);
            return connection.rollback(() => reject(err));
          }
          resolve();
        });
      });

      console.log(`[${timestamp}] All steps committed successfully`);

      // Insert notification for superadmin after successful commit
      try {
        // Get user_id and name for notification
        let userInfoResult = await new Promise((resolve, reject) => {
          connection.query('SELECT id, first_name, middle_name, last_name, suffix FROM step1_identifying_information WHERE code_id = ? LIMIT 1', [code_id], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        let userIdForNotif = null;
        let userFullName = '';
        if (userInfoResult && userInfoResult.length > 0) {
          userIdForNotif = userInfoResult[0].id;
          userFullName = `${userInfoResult[0].first_name || ''} ${userInfoResult[0].middle_name || ''} ${userInfoResult[0].last_name || ''}${userInfoResult[0].suffix && userInfoResult[0].suffix !== 'none' ? ` ${userInfoResult[0].suffix}` : ''}`.trim().replace(/\s+/g, ' ');
        } else {
          // Fallback: try to get name from users table
          userInfoResult = await new Promise((resolve, reject) => {
            connection.query('SELECT id, name FROM users WHERE code_id = ? LIMIT 1', [code_id], (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          if (userInfoResult && userInfoResult.length > 0) {
            userIdForNotif = userInfoResult[0].id;
            userFullName = userInfoResult[0].name;
          } else {
            userFullName = 'Unknown User';
          }
        }

        // Get human-readable document label
        const docLabels = {
          'psa': 'PSA Birth Certificate',
          'itr': 'Income Tax Return',
          'med_cert': 'Medical Certificate',
          'marriage': 'Marriage Certificate',
          'cenomar': 'CENOMAR',
          'death_cert': 'Death Certificate',
          'barangay_cert': 'Barangay Certificate'
        };
        let documentLabel = docLabels[documentType] || documentType;

        if (userIdForNotif) {
          const notifType = 'follow_up_doc';
          const notifMessage = `${userFullName} uploaded a follow-up document for his ${documentLabel}`;
          await new Promise((resolve, reject) => {
            connection.query(
              `INSERT INTO superadminnotifications (user_id, notif_type, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())`,
              [userIdForNotif, notifType, notifMessage],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });
          console.log('Superadmin notification inserted for document upload');
        } else {
          console.warn('User ID not found for notification');
        }
      } catch (notifError) {
        console.error('Error inserting superadmin notification:', notifError);
      }

      res.json({
        success: true,
        message: 'All steps submitted successfully',
        code_id: code_id
      });
    } catch (innerError) {
      // If we encounter any error during the insert steps, roll back and throw
      console.error(`[${timestamp}] Error during steps submission:`, innerError);
      await new Promise((resolve) => connection.rollback(() => resolve()));
      throw innerError;
    }
  } catch (error) {
    console.error('Error submitting steps:', error);
    // Roll back transaction if an error occurred
    if (connection) {
      try {
        await new Promise((resolve) => connection.rollback(() => resolve()));
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }
    
    // Provide user-friendly error responses based on error type
    if (error.code === 'ER_DUP_ENTRY') {
      const match = error.message.match(/key '(.+?)'/);
      const keyName = match ? match[1] : 'unknown';
      
      res.status(400).json({
        success: false,
        error: 'Duplicate entry detected',
        details: `A record with this ${keyName.includes('email') ? 'email' : 'information'} already exists.`,
        errorCode: error.code
      });
    } else if (error.code === 'ER_LOCK_WAIT_TIMEOUT') {
      res.status(409).json({
        success: false,
        error: 'Database busy',
        details: 'The system is currently processing another request. Please try again in a moment.',
        errorCode: error.code
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to submit steps',
        details: error.message,
        errorCode: error.code || 'UNKNOWN_ERROR'
      });
    }
  } finally {
    if (connection) {
      // Reset isolation level before releasing
      try {
        await new Promise(resolve => {
          connection.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ", () => {
            resolve();
          });
        });
      } catch (err) {
        console.error('Error resetting isolation level:', err);
      }
      
      connection.release();
    }
  }
});

router.post('/follow_up', async (req, res) => {
  const { code_id, document_type, file_url, display_name, status = 'Pending' } = req.body;
  let connection;

  console.log('Received follow-up document upload request:', req.body);

  try {
    // Validate document type
    const tableName = TABLE_NAMES[document_type];
    if (!tableName) {
      throw new Error(`Invalid document type: ${document_type}`);
    }

    // Get a connection and start transaction
    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Verify the code_id exists in step1_identifying_information
    const verifyQuery = `SELECT code_id FROM step1_identifying_information WHERE code_id = ? LIMIT 1`;
    const verifyResult = await new Promise((resolve, reject) => {
      connection.query(verifyQuery, [code_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    if (verifyResult.length === 0) {
      throw new Error('Invalid code_id');
    }

    // Insert directly into the specific document table with category 'followup'
    const insertQuery = `
      INSERT INTO ${tableName.table} (code_id, file_name, display_name, status, category, uploaded_at)
      VALUES (?, ?, ?, ?, 'followup', NOW())
      ON DUPLICATE KEY UPDATE
        file_name = VALUES(file_name),
        display_name = VALUES(display_name),
        status = VALUES(status),
        category = 'followup',
        uploaded_at = NOW()
    `;

    await new Promise((resolve, reject) => {
      connection.query(insertQuery, [code_id, file_url, display_name, 'Pending'], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({ success: true, message: 'Follow-up document uploaded successfully' });
  } catch (error) {
    console.error('Error uploading document to updateMissingDocument:', error);
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Handle document upload
router.post('/:documentType', async (req, res) => {
  const { documentType } = req.params;
  const { code_id, file_name, uploaded_at, display_name, status = 'Pending' } = req.body;
  let connection;

  console.log('Received document upload request:', req.body);

  try {
    // Validate document type
    const tableName = TABLE_NAMES[documentType];
    if (!tableName) {
      throw new Error(`Invalid document type: ${documentType}`);
    }

    // Get a connection and start transaction
    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Verify the code_id exists in step1_identifying_information
    const verifyQuery = `SELECT code_id FROM step1_identifying_information WHERE code_id = ? LIMIT 1`;
    const verifyResult = await new Promise((resolve, reject) => {
      connection.query(verifyQuery, [code_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    if (!verifyResult || verifyResult.length === 0) {
      console.error('Invalid code_id:', code_id);
      console.error('Verification result:', verifyResult);
      throw new Error(`Invalid code_id: ${code_id}`);
    }

    // Check if document already exists
    const existingDocQuery = `SELECT * FROM ${tableName.table} WHERE code_id = ? LIMIT 1`;
    const existingDoc = await new Promise((resolve, reject) => {
      connection.query(existingDocQuery, [code_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    console.log('Existing document:', existingDoc);

    let result;
    if (existingDoc.length > 0) {
      // Update existing document
      const updateQuery = `
        UPDATE ${tableName.table} 
        SET file_name = ?, uploaded_at = ?, display_name = ?, status = ?
        WHERE code_id = ?`;
      result = await new Promise((resolve, reject) => {
        connection.query(updateQuery, [file_name, new Date(), display_name, 'Pending', code_id], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log('Updated document:', result);
    } else {
      // Insert new document
      let insertQuery;
      let insertValues;
      // Only include 'category' for tables that have that column
      if (tableName.table !== 'barangay_cert_documents') {
        insertQuery = `
          INSERT INTO ${tableName.table} (code_id, file_name, uploaded_at, display_name, status, category)
          VALUES (?, ?, ?, ?, ?, ?)`;
        insertValues = [code_id, file_name, new Date(), display_name, 'Pending', 'application'];
      } else {
        insertQuery = `
          INSERT INTO ${tableName.table} (code_id, file_name, uploaded_at, display_name, status)
          VALUES (?, ?, ?, ?, ?)`;
        insertValues = [code_id, file_name, new Date(), display_name, 'Pending'];
      }
      result = await new Promise((resolve, reject) => {
        connection.query(insertQuery, insertValues, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      console.log('Inserted document:', result);
    }

    // Commit the transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) {
          connection.rollback(() => reject(err));
        } else {
          resolve();
        }
      });
    });

    // Insert notification for superadmin after successful document upload
    try {
      // Get user_id and name for notification
      let userInfoResult = await new Promise((resolve, reject) => {
        connection.query('SELECT id, first_name, middle_name, last_name, suffix FROM step1_identifying_information WHERE code_id = ? LIMIT 1', [code_id], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      let userIdForNotif = null;
      let userFullName = '';
      if (userInfoResult && userInfoResult.length > 0) {
        userIdForNotif = userInfoResult[0].id;
        userFullName = `${userInfoResult[0].first_name || ''} ${userInfoResult[0].middle_name || ''} ${userInfoResult[0].last_name || ''}${userInfoResult[0].suffix && userInfoResult[0].suffix !== 'none' ? ` ${userInfoResult[0].suffix}` : ''}`.trim().replace(/\s+/g, ' ');
      } else {
        // Fallback: try to get name from users table
        userInfoResult = await new Promise((resolve, reject) => {
          connection.query('SELECT id, name FROM users WHERE code_id = ? LIMIT 1', [code_id], (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        if (userInfoResult && userInfoResult.length > 0) {
          userIdForNotif = userInfoResult[0].id;
          userFullName = userInfoResult[0].name;
        } else {
          userFullName = 'Unknown User';
        }
      }

      // Get human-readable document label
      const docLabels = {
        'psa': 'PSA Birth Certificate',
        'itr': 'Income Tax Return',
        'med_cert': 'Medical Certificate',
        'marriage': 'Marriage Certificate',
        'cenomar': 'CENOMAR',
        'death_cert': 'Death Certificate',
        'barangay_cert': 'Barangay Certificate'
      };
      let documentLabel = docLabels[documentType] || documentType;

      if (userIdForNotif) {
        const notifType = 'follow_up_doc';
        
        // Check if it's a follow-up document
        let isFollowUp = false;
        if (documentType === 'barangay_cert') {
          isFollowUp = true;
        } else if (existingDoc.length > 0) {
          // For existing document updates
          const checkCategoryQuery = `SELECT category FROM ${tableName.table} WHERE code_id = ? LIMIT 1`;
          const categoryResult = await new Promise((resolve, reject) => {
            connection.query(checkCategoryQuery, [code_id], (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          isFollowUp = categoryResult[0]?.category === 'followup';
        } else {
          // For new document inserts
          isFollowUp = insertValues?.[5] === 'followup';
        }

        if (isFollowUp) {
          const notifMessage = documentType === 'barangay_cert' 
            ? `${userFullName} uploaded a ${documentLabel} for his Renewal`
            : `${userFullName} uploaded a follow-up document for his ${documentLabel}`;
          
          await new Promise((resolve, reject) => {
            connection.query(
              `INSERT INTO superadminnotifications (user_id, notif_type, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())`,
              [userIdForNotif, notifType, notifMessage],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });
          console.log('Superadmin notification inserted for document upload');
        }
      } else {
        console.warn('User ID not found for notification');
      }
    } catch (notifError) {
      console.error('Error inserting superadmin notification:', notifError);
    }

    res.json({
      success: true,
      message: `Document ${existingDoc.length > 0 ? 'updated' : 'uploaded'} successfully`,
      documentId: result.insertId || existingDoc[0]?.[tableName.idColumn]
    });
  } catch (error) {
    console.error(`Error uploading document to ${documentType}:`, error);
    
    // Rollback transaction if there was an error
    if (connection) {
      await new Promise(resolve => {
        connection.rollback(() => resolve());
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to upload document',
      details: error.message
    });
  } finally {
    // Release connection
    if (connection) {
      connection.release();
    }
  }
});

// Handle barangay certificate upload
router.post('/barangay_cert', async (req, res) => {
  let connection;
  try {
    const { code_id, file_name, display_name } = req.body;
    console.log('Received barangay certificate upload request:', req.body);

    if (!code_id || !file_name || !display_name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: {
          code_id: !code_id ? 'missing' : 'present',
          file_name: !file_name ? 'missing' : 'present',
          display_name: !display_name ? 'missing' : 'present'
        }
      });
    }

    // Get connection and start transaction
    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Verify the code_id exists in users table
    const verifyQuery = `SELECT code_id FROM users WHERE code_id = ? LIMIT 1`;
    const verifyResult = await new Promise((resolve, reject) => {
      connection.query(verifyQuery, [code_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    if (!verifyResult || verifyResult.length === 0) {
      console.error('Invalid code_id:', code_id);
      throw new Error(`Invalid code_id: ${code_id}`);
    }

    // Check if document already exists
    const existingDocQuery = `SELECT * FROM barangay_cert_documents WHERE code_id = ? LIMIT 1`;
    const existingDoc = await new Promise((resolve, reject) => {
      connection.query(existingDocQuery, [code_id], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    let result;
    if (existingDoc.length > 0) {
      // Update existing document
      const updateQuery = `
        UPDATE barangay_cert_documents 
        SET file_name = ?, uploaded_at = ?, display_name = ?, status = ?
        WHERE code_id = ?`;
      result = await new Promise((resolve, reject) => {
        connection.query(updateQuery, [file_name, new Date(), display_name, 'Pending', code_id], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    } else {
      // Insert new document
      const insertQuery = `
        INSERT INTO barangay_cert_documents (code_id, file_name, uploaded_at, display_name, status)
        VALUES (?, ?, ?, ?, ?)`;
      result = await new Promise((resolve, reject) => {
        connection.query(insertQuery, [code_id, file_name, new Date(), display_name, 'Pending'], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    }

    // Commit the transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) {
          connection.rollback(() => reject(err));
        } else {
          resolve();
        }
      });
    });

    res.json({
      success: true,
      message: `Barangay certificate ${existingDoc.length > 0 ? 'updated' : 'uploaded'} successfully`,
      documentId: result.insertId || existingDoc[0]?.[TABLE_NAMES['barangay_cert'].idColumn]
    });
  } catch (error) {
    console.error('Error uploading barangay certificate:', error);
    
    // Rollback transaction if there was an error
    if (connection) {
      await new Promise(resolve => {
        connection.rollback(() => resolve());
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to upload barangay certificate',
      details: error.message
    });
  } finally {
    // Release connection
    if (connection) {
      connection.release();
    }
  }
});

// Get missing documents
router.get('/follow_up_documents', async (req, res) => {
  let connection;
  try {
    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    // Query for all document tables with specific columns
    const queries = [
      `SELECT psa_id AS id, code_id, file_name, file_name as file_url, display_name, status, 'psa_documents' as document_type, uploaded_at as follow_up_date 
       FROM psa_documents WHERE status = 'Pending' AND category = 'followup'`,
      `SELECT itr_id AS id, code_id, file_name, file_name as file_url, display_name, status, 'itr_documents' as document_type, uploaded_at as follow_up_date 
       FROM itr_documents WHERE status = 'Pending' AND category = 'followup'`,
      `SELECT marriage_id AS id, code_id, file_name, file_name as file_url, display_name, status, 'marriage_documents' as document_type, uploaded_at as follow_up_date 
       FROM marriage_documents WHERE status = 'Pending' AND category = 'followup'`,
      `SELECT med_cert_id AS id, code_id, file_name, file_name as file_url, display_name, status, 'med_cert_documents' as document_type, uploaded_at as follow_up_date 
       FROM med_cert_documents WHERE status = 'Pending' AND category = 'followup'`,
      `SELECT cenomar_id AS id, code_id, file_name, file_name as file_url, display_name, status, 'cenomar_documents' as document_type, uploaded_at as follow_up_date 
       FROM cenomar_documents WHERE status = 'Pending' AND category = 'followup'`,
      `SELECT death_cert_id AS id, code_id, file_name, file_name as file_url, display_name, status, 'death_cert_documents' as document_type, uploaded_at as follow_up_date 
       FROM death_cert_documents WHERE status = 'Pending' AND category = 'followup'` 
    ];

    const combinedQuery = queries.join(' UNION ALL ') + 
      ' ORDER BY follow_up_date ASC';

    const results = await new Promise((resolve, reject) => {
      connection.query(combinedQuery, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    res.json(results);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.delete('/barangay_cert/:code_id', async (req, res) => {
  try {
    const { code_id } = req.params;
    await queryDatabase('DELETE FROM barangay_cert_documents WHERE code_id = ?', [code_id]);
    res.json({ message: 'Barangay certificate deleted successfully' });
  } catch (error) {
    console.error('Error deleting barangay certificate:', error);
    res.status(500).json({ error: 'Failed to delete barangay certificate' });
  }
});

module.exports = router;
