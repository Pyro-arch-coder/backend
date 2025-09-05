const express = require('express');
const router = express.Router();
const { pool, queryDatabase } = require('../database');
const faceapi = require('face-api.js');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const fetch = require('node-fetch');
const canvas = require('canvas');
const { Canvas, Image } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image });

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Get the absolute path to the models directory
const modelsPath = path.join(__dirname, '..', 'models');

// Load face-api.js models
async function loadModels() {
    try {
        await faceapi.nets.tinyFaceDetector.loadFromDisk(modelsPath);
        await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
        await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
        console.log('Face detection models loaded successfully');
    } catch (error) {
        console.error('Error loading face detection models:', error);
        throw error;
    }
}

// Initialize models when the route is loaded
loadModels().catch(console.error);

// Helper function to calculate face distance
const calculateFaceDistance = (descriptor1, descriptor2) => {
    let sum = 0;
    for (let i = 0; i < descriptor1.length; i++) {
        sum += Math.pow(descriptor1[i] - descriptor2[i], 2);
    }
    return Math.sqrt(sum);
};

// Function to compare two descriptors and return a similarity score (0-100%)
const calculateSimilarityPercentage = (descriptor1, descriptor2) => {
    const distance = calculateFaceDistance(descriptor1, descriptor2);
    // Convert distance to percentage (1.0 distance → 0% similarity, 0.0 distance → 100% similarity)
    // Typically distances below 0.6 are considered good matches
    const normalizedDistance = Math.min(distance, 1.0); // Cap at 1.0
    const similarityPercentage = (1 - normalizedDistance) * 100;
    return similarityPercentage.toFixed(2);
};

// Route to check if user exists and is verified
router.post('/check-user-status', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email is required' 
            });
        }
        
        // Get user by email
        const users = await queryDatabase(
            'SELECT id, email, name, code_id, status, faceRecognitionPhoto FROM users WHERE email = ?', 
            [email]
        );
        
        if (!users || users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'User not found with this email' 
            });
        }
        
        const user = users[0];
        
        // Return user status and whether they have face recognition
        return res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                status: user.status,
                hasFaceRecognition: user.faceRecognitionPhoto ? true : false
            }
        });
    } catch (error) {
        console.error('Error checking user status:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error while checking user status' 
        });
    }
});

// Route to authenticate user with face
router.post('/', async (req, res) => {
    console.log('\n===== NEW FACE AUTHENTICATION REQUEST =====');
    try {
        const { descriptor } = req.body;
        
        // Validate required inputs
        if (!descriptor) {
            console.log('No face descriptor provided in request');
            return res.status(400).json({ success: false, error: 'No face descriptor provided' });
        }
        
        // Get all verified users with face photos
        console.log('Retrieving users with registered face photos...');
        const users = await queryDatabase(`
            SELECT id, email, name, code_id, status, faceRecognitionPhoto
            FROM users 
            WHERE status = 'Verified' 
            AND faceRecognitionPhoto IS NOT NULL
        `);
        
        if (!users || users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'No users with registered face photos found' 
            });
        }
        
        console.log(`Found ${users.length} users with registered face photos`);
        
        // Process users in batches for better memory management
        const BATCH_SIZE = 20; // Process 20 users at a time
        let bestMatch = null;
        let bestSimilarity = 0;
        
        // Split users into batches
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(users.length/BATCH_SIZE)}`);
            
            // Process batch in parallel
            const batchPromises = batch.map(async (user) => {
                try {
                    // Get the image URL from Cloudinary
                    const imageUrl = user.faceRecognitionPhoto;
                    
                    if (!imageUrl) {
                        return null;
                    }
                    
                    // Download the image from Cloudinary
                    const response = await fetch(imageUrl);
                    
                    if (!response.ok) {
                        return null;
                    }
                    
                    const arrayBuffer = await response.arrayBuffer();
                    const imageBuffer = Buffer.from(arrayBuffer);
                    
                    // Create a new Image instance
                    const image = new Image();
                    image.src = imageBuffer;
                    
                    // Use optimized detection settings for speed
                    const detectorOptions = new faceapi.TinyFaceDetectorOptions({ 
                        inputSize: 160,  // Smaller input size for faster processing
                        scoreThreshold: 0.3
                    });
                    
                    // Detect face with optimized settings
                    const detections = await faceapi.detectSingleFace(image, detectorOptions)
                        .withFaceLandmarks()
                        .withFaceDescriptor();
                    
                    if (!detections) {
                        return null;
                    }
                    
                    // Calculate similarity
                    const similarity = calculateSimilarityPercentage(descriptor, detections.descriptor);
                    console.log(`Face match for ${user.name}: ${similarity}%`);
                    
                    return { user, similarity };
                } catch (error) {
                    console.error(`Error processing user ${user.id}:`, error);
                    return null;
                }
            });
            
            // Wait for batch to complete
            const batchResults = await Promise.all(batchPromises);
            
            // Filter out null results
            const validBatchResults = batchResults.filter(result => result !== null);
            
            // Find the best match in this batch
            for (const result of validBatchResults) {
                if (parseFloat(result.similarity) > parseFloat(bestSimilarity)) {
                    bestMatch = result;
                    bestSimilarity = result.similarity;
                    
                    // Early exit if we found an excellent match (over 80%)
                    if (parseFloat(bestSimilarity) > 80) {
                        console.log(`Found excellent match (${bestSimilarity}%), stopping search`);
                        i = users.length; // Force exit from outer loop
                        break;
                    }
                }
            }
        }
        
        // Check if we found a good match
        if (bestMatch && parseFloat(bestSimilarity) > 50) {
            console.log(`Best match: ${bestMatch.user.name} with similarity ${bestSimilarity}%`);
            // Remove sensitive info before response
            const { faceRecognitionPhoto, ...userData } = bestMatch.user;
            return res.json({
                success: true,
                user: userData,
                similarity: bestSimilarity
            });
        }
        
        // No good match found
        console.log(`No match found above threshold of 50%`);
        return res.status(401).json({ 
            success: false, 
            error: 'Face not recognized. Try adjusting lighting or position your face more clearly in the camera.'
        });
    } catch (error) {
        console.error('Face authentication error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error during face authentication. Please try again.' 
        });
    }
});

module.exports = router;