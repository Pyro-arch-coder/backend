const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { pool } = require('../database');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadToCloudinary(base64, folder, public_id) {
  try {
    return await cloudinary.uploader.upload(base64, {
      folder,
      public_id,
      overwrite: true,
    });
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    throw err;
  }
}

router.post('/upload-id-card', async (req, res) => {
  try {
    console.log('Received ID card upload request');
    
    // Extract and validate request parameters
    const { userId, codeId, frontImage, backImage } = req.body;
    console.log(`Processing upload for userId: ${userId}, codeId: ${codeId}`);
    console.log(`Front image length: ${frontImage ? frontImage.length : 0}, Back image length: ${backImage ? backImage.length : 0}`);
    
    if (!userId || !codeId || !frontImage || !backImage) {
      console.error('Missing required fields:', { 
        hasUserId: !!userId, 
        hasCodeId: !!codeId, 
        hasFrontImage: !!frontImage, 
        hasBackImage: !!backImage 
      });
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Check if ID card already exists in the database
    console.log(`Checking if ID card already exists for userId: ${userId}, codeId: ${codeId}`);
    const checkExistingQuery = 'SELECT * FROM user_id_cards WHERE user_id = ? AND code_id = ?';
    
    pool.query(checkExistingQuery, [userId, codeId], async (checkErr, checkResult) => {
      if (checkErr) {
        console.error('Database error when checking existing ID card:', checkErr);
        return res.status(500).json({ 
          success: false, 
          error: 'Database error when checking existing records', 
          details: checkErr.message 
        });
      }
      
      // If ID card already exists, return the existing record
      if (checkResult && checkResult.length > 0) {
        console.log(`ID card already exists for userId: ${userId}, codeId: ${codeId}`);
        return res.json({
          success: true,
          frontUrl: checkResult[0].front_url,
          backUrl: checkResult[0].back_url,
          message: 'ID card already exists',
          isExisting: true
        });
      }
      
      // If no existing record, proceed with upload to Cloudinary
      console.log(`No existing ID card found. Uploading to Cloudinary folder: id_cards/${codeId}`);
      const folder = `id_cards/${codeId}`;
      
      try {
        const [frontRes, backRes] = await Promise.all([
          uploadToCloudinary(frontImage, folder, 'front'),
          uploadToCloudinary(backImage, folder, 'back'),
        ]);
        
        console.log('Cloudinary upload successful');
        console.log('Front URL:', frontRes.secure_url);
        console.log('Back URL:', backRes.secure_url);

        // Save to DB (INSERT instead of REPLACE to avoid overwriting)
        console.log(`Saving to database for user_id: ${userId}`);
        pool.query(
          'INSERT INTO user_id_cards (user_id, code_id, front_url, back_url) VALUES (?, ?, ?, ?)',
          [userId, codeId, frontRes.secure_url, backRes.secure_url],
          (err, result) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ success: false, error: 'Database error', details: err.message });
            }
            
            console.log('Database insert successful, rows affected:', result.affectedRows);
            res.json({
              success: true,
              frontUrl: frontRes.secure_url,
              backUrl: backRes.secure_url,
              message: 'ID card uploaded and saved successfully',
              isNew: true
            });
          }
        );
      } catch (cloudinaryErr) {
        console.error('Cloudinary upload error:', cloudinaryErr);
        return res.status(500).json({ 
          success: false, 
          error: 'Cloudinary upload failed', 
          details: cloudinaryErr.message 
        });
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error processing upload', 
      details: err.message 
    });
  }
});

module.exports = router;