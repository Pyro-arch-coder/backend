const mysql = require('mysql');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',  // Using IPv4 localhost
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'soloparent',
  port: parseInt(process.env.DB_PORT) || 3306,  // Ensure port is a number
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Force IPv4
  socketPath: null,
  // Additional connection settings
  connectTimeout: 10000, // 10 seconds
  acquireTimeout: 10000, // 10 seconds
  debug: process.env.NODE_ENV === 'development' // Enable debug in development
};

console.log('Database config:', dbConfig);

const pool = mysql.createPool(dbConfig);

// Test the connection
console.log('Attempting to connect to database with config:', {
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  usingSocket: !!dbConfig.socketPath
});

pool.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Error connecting to database:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      address: err.address,
      port: err.port,
      stack: err.stack
    });
    console.error('💡 Troubleshooting tips:');
    console.error('1. Make sure MySQL server is running');
    console.error('2. Verify the database credentials in .env file');
    console.error('3. Check if MySQL is configured to accept connections on 127.0.0.1');
    console.error('4. Try connecting manually using: mysql -h 127.0.0.1 -u root -p');
    process.exit(1);
  }
  console.log('✅ Successfully connected to database');
  connection.release();
});

const queryDatabase = (sql, params) => new Promise((resolve, reject) => {
  pool.getConnection((err, connection) => {
    if (err) {
      console.error('Error getting connection:', err);
      return reject(err);
    }

    console.log('\n=== Database Query Debug ===');
    console.log('SQL:', sql);
    console.log('Parameters:', params);

    // Reset the connection before executing the query
    connection.query('RESET QUERY CACHE', (err) => {
      if (err) {
        console.error('Error resetting query cache:', err);
      }

      connection.query(sql, params, (err, result) => {
        connection.release();
        if (err) {
          console.error('Query error:', err);
          return reject(err);
        }
        console.log('Query result:', result);
        console.log('=========================\n');
        resolve(result);
      });
    });
  });
});

const upsertDocument = async (tableName, code_id, file_name, display_name, status = 'Pending') => {
  let connection;
  try {
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

    // Check if document exists
    const existingDocQuery = `SELECT * FROM ${tableName} WHERE code_id = ? LIMIT 1`;
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
        UPDATE ${tableName} 
        SET file_name = ?, display_name = ?, status = ?
        WHERE code_id = ?`;
      
      result = await new Promise((resolve, reject) => {
        connection.query(updateQuery, [file_name, display_name, status, code_id], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      
      await new Promise((resolve, reject) => {
        connection.commit(err => {
          if (err) {
            connection.rollback(() => reject(err));
          } else {
            resolve();
          }
        });
      });
      
      return {
        action: 'updated',
        id: existingDoc[0].id
      };
    } else {
      // Insert new document
      const insertQuery = `
        INSERT INTO ${tableName} (code_id, file_name, display_name, status)
        VALUES (?, ?, ?, ?)`;
      
      result = await new Promise((resolve, reject) => {
        connection.query(insertQuery, [code_id, file_name, display_name, status], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
      
      await new Promise((resolve, reject) => {
        connection.commit(err => {
          if (err) {
            connection.rollback(() => reject(err));
          } else {
            resolve();
          }
        });
      });
      
      return {
        action: 'inserted',
        id: result.insertId
      };
    }
  } catch (error) {
    if (connection) {
      await new Promise(resolve => {
        connection.rollback(() => resolve());
      });
    }
    console.error(`Error upserting document in ${tableName}:`, error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const deleteDocument = async (tableName, code_id) => {
  try {
    const result = await queryDatabase(
      `DELETE FROM ${tableName} WHERE code_id = ?`,
      [code_id]
    );
    return result.affectedRows > 0;
  } catch (error) {
    console.error(`Error deleting document from ${tableName}:`, error);
    throw error;
  }
};

const getUserDocuments = async (code_id) => {
  try {
    const documents = {};
    const tables = [
      'psa_documents',
      'itr_documents',
      'med_cert_documents',
      'marriage_documents',
      'cenomar_documents',
      'death_cert_documents'
    ];

    for (const table of tables) {
      const result = await queryDatabase(
        `SELECT * FROM ${table} WHERE code_id = ? LIMIT 1`,
        [code_id]
      );
      if (result.length > 0) {
        documents[table] = result[0];
      }
    }

    return documents;
  } catch (error) {
    console.error('Error getting user documents:', error);
    throw error;
  }
};

const getDocumentStatus = async (tableName, code_id) => {
  try {
    if (!code_id) {
      throw new Error('code_id is required');
    }

    const query = `
      SELECT id, file_name, uploaded_at, display_name, status, rejection_reason
      FROM ${tableName}
      WHERE code_id = ?
      ORDER BY uploaded_at DESC
      LIMIT 1
    `;
    const results = await queryDatabase(query, [code_id]);
    console.log(`Document status for ${tableName}:`, results[0] || null);
    return results[0] || null;
  } catch (error) {
    console.error(`Error getting document status from ${tableName}:`, error);
    throw error;
  }
};

module.exports = {
  pool,
  queryDatabase,
  upsertDocument,
  deleteDocument,
  getUserDocuments,
  getDocumentStatus
};
