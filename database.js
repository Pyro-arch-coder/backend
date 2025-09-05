const mysql = require('mysql');
require('dotenv').config();

// Force Node.js to use IPv4
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// Database configuration with forced IPv4 and no password
const dbConfig = {
  host: '127.0.0.1',  // Force IPv4
  user: 'root',
  password: '',       // No password
  database: 'soloparent',
  port: 3306,
  // Connection settings
  connectionLimit: 10,
  connectTimeout: 10000, // 10 seconds
  waitForConnections: true,
  queueLimit: 0,
  // Force TCP/IP connection (not socket)
  socketPath: null,
  // Disable IPv6
  ipFamily: 4,
  // Debug
  debug: true,
  // Additional options
  multipleStatements: true,
  // Ensure no password is sent
  insecureAuth: true
};

console.log('Database config:', dbConfig);

const pool = mysql.createPool(dbConfig);

// Enhanced connection test
console.log('\n=== 🛠️ Testing database connection ===');
console.log('🔧 Connection details:', {
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  hasPassword: dbConfig.password ? 'Yes' : 'No'
});

console.log('\n🔍 Checking if MySQL is running...');

pool.getConnection((err, connection) => {
  if (err) {
    console.error('\n❌ Connection failed:', err.message);
    
    // More specific error handling
    if (err.code === 'ECONNREFUSED') {
      console.log('\n🔧 The connection was refused. This usually means:');
      console.log('1. MySQL service is not running');
      console.log('2. MySQL is not accepting connections on port 3306');
      console.log('3. The MySQL server is not configured to accept TCP/IP connections');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n🔧 Authentication failed. Please check:');
      console.log('1. Username is correct');
      console.log('2. Password is correct (empty in this case)');
      console.log('3. User has proper permissions');
    }

    console.log('\n🛠️ Troubleshooting steps:');
    console.log('1. Open XAMPP/WAMP and ensure MySQL is running (green light)');
    console.log('2. Try connecting manually using:');
    console.log('   - XAMPP: Open MySQL console from XAMPP Control Panel');
    console.log('   - WAMP: Click WAMP icon → MySQL → MySQL Console');
    console.log('3. If using command line:');
    console.log('   mysql -u root -h 127.0.0.1 -P 3306');
    console.log('   (Press Enter when asked for password)');
    
    process.exit(1);
  }

  console.log('\n✅ Success! Connected to MySQL server');
  console.log('   Database:', connection.config.database);
  console.log('   Server version:', connection.state);
  
  // Test a simple query
  console.log('\n🔍 Testing database query...');
  connection.query('SELECT 1 as test', (err, results) => {
    if (err) {
      console.error('❌ Test query failed:', err.message);
      console.log('\n🔧 This might indicate:');
      console.log('1. The database does not exist');
      console.log('2. The user does not have permission to access the database');
    } else {
      console.log('✅ Test query successful! Server responded with:', results[0]);
    }
    connection.release();
  });
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
