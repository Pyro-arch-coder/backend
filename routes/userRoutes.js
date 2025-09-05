const nodemailer = require('nodemailer');

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail', // or another service like 'outlook', 'yahoo', etc.
  auth: {
    user: 'your-email@gmail.com', // replace with your email
    pass: 'your-app-password' // replace with your app password or email password
  }
});

// Update your existing route handler for updateUserStatus
router.post('/updateUserStatus', async (req, res) => {
  try {
    const { userId, status, remarks, email, name } = req.body;
    
    // Update user status in database
    // Your existing code to update the database...
    
    // Send email notification
    if (email) {
      const emailSubject = status === 'Verified' 
        ? 'Your Application Has Been Approved' 
        : 'Update on Your Application Status';
      
      const emailContent = status === 'Verified'
        ? `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
            <h2 style="color: #4CAF50; text-align: center;">Application Approved!</h2>
            <p>Dear ${name},</p>
            <p>We are pleased to inform you that your application has been <strong>approved</strong>.</p>
            <p>You can now log in to your account to access all features and services.</p>
            <p>Thank you for your patience during the verification process.</p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #777; font-size: 12px;">
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>`
        : `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
            <h2 style="color: #F44336; text-align: center;">Application Status Update</h2>
            <p>Dear ${name},</p>
            <p>We regret to inform you that your application has been <strong>declined</strong>.</p>
            <p><strong>Reason:</strong> ${remarks}</p>
            <p>If you believe this decision was made in error or if you would like to provide additional information, please contact our support team.</p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #777; font-size: 12px;">
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>`;
      
      const mailOptions = {
        from: 'your-email@gmail.com', // replace with your email
        to: email,
        subject: emailSubject,
        html: emailContent
      };
      
      await transporter.sendMail(mailOptions);
      console.log(`Email notification sent to ${email}`);
    }
    
    res.status(200).json({ message: `User status updated to ${status}` });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: error.message });
  }
}); 