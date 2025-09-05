const nodemailer = require('nodemailer');

// Create a more robust transporter with better error handling
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  },
  debug: true, // Enable debug output
  logger: true // Log information about the transport mechanism
});

const sendStatusEmail = async (email, firstName, action, remarks = '', dateOfBirth = '', password = '') => {
  const messageTemplates = {
    Accept: `Dear ${firstName},

We are pleased to inform you that your Solo Parent ID application has been approved by the Department of Social Welfare and Development (DSWD).

You may now visit your respective Barangay Office to claim your Solo Parent ID. Please bring a valid government ID for verification purposes.

Your login credentials:
Email/Username: ${email}
Password: ${password}

For any inquiries, please contact your Barangay Office or DSWD Office.

Best regards,
Department of Social Welfare and Development
Solo Parent Support Division`,

    Decline: `Dear ${firstName},

We regret to inform you that after careful review, your Solo Parent ID application has been declined by the Department of Social Welfare and Development (DSWD).

Reason for Decline:
${remarks}

If you wish to appeal this decision or submit a new application, please visit your Barangay Office for guidance on the necessary steps and requirements.

For any clarifications, please contact your Barangay Office or DSWD Office.

Best regards,
Department of Social Welfare and Development
Solo Parent Support Division`
  };

  const mailOptions = {
    from: 'santamariasoloparent@gmail.com',
    to: email,
    subject: action === "Accept" ? "Solo Parent Application Approved!" : "Update on Your Solo Parent Application",
    text: messageTemplates[action]
  };

  try {
    console.log(`Attempting to send ${action} email to: ${email}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully to:', email);
    console.log('Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

const sendRenewalStatusEmail = async (email, firstName, action, remarks = '') => {
  const messageTemplates = {
    Accept: `Dear ${firstName},

We are pleased to inform you that your Solo Parent ID renewal has been approved by the Department of Social Welfare and Development (DSWD).

Your Solo Parent ID has been successfully renewed and will remain valid for the next period. You may visit your respective Barangay Office to claim your updated Solo Parent ID if applicable.

Important Information:
- Your Solo Parent status has been verified and updated in our system
- All benefits and privileges associated with your Solo Parent ID will continue
- Please keep your ID in a safe place and present it when availing services

For any inquiries about your renewed Solo Parent ID, please contact your Barangay Office or DSWD Office.

Best regards,
Department of Social Welfare and Development
Solo Parent Support Division`,

    Decline: `Dear ${firstName},

We regret to inform you that after careful review, your Solo Parent ID renewal application has been declined by the Department of Social Welfare and Development (DSWD).

Reason for Decline:
${remarks}

Your Solo Parent ID will no longer be valid, and you will need to submit a new application with the required documentation if you wish to reapply.

If you believe this decision was made in error or need guidance on reapplying, please visit your Barangay Office for assistance.

For any clarifications, please contact your Barangay Office or DSWD Office.

Best regards,
Department of Social Welfare and Development
Solo Parent Support Division`
  };

  const mailOptions = {
    from: 'santamariasoloparent@gmail.com',
    to: email,
    subject: action === "Accept" ? "Solo Parent ID Renewal Approved!" : "Update on Your Solo Parent ID Renewal",
    text: messageTemplates[action]
  };

  try {
    console.log(`Attempting to send renewal ${action} email to: ${email}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Renewal email sent successfully to:', email);
    console.log('Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending renewal email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return false;
  }
};

const sendRevokeEmail = async (email, firstName) => {
  // Calculate the grace period end date (7 days from now)
  const today = new Date();
  const gracePeriodEnd = new Date(today);
  gracePeriodEnd.setDate(today.getDate() + 7);
  
  // Format the date as Month Day, Year
  const formattedDate = gracePeriodEnd.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const messageTemplate = `Dear ${firstName},

We regret to inform you that your Solo Parent ID status is currently under review by the Department of Social Welfare and Development (DSWD).

Your Solo Parent ID will remain active for a grace period of 7 days until ${formattedDate}. During this time, you may still use your ID for any applicable benefits and services.

If you believe this review is in error or if you need to provide additional documentation to maintain your status, please visit your Barangay Office as soon as possible.

For any clarifications or assistance, please contact your Barangay Office or DSWD Office.

Best regards,
Department of Social Welfare and Development
Solo Parent Support Division`;

  const mailOptions = {
    from: 'santamariasoloparent@gmail.com',
    to: email,
    subject: "Important Notice: Solo Parent ID Status Review",
    text: messageTemplate
  };

  try {
    console.log(`Attempting to send revocation email to: ${email}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Revocation email sent successfully to:', email);
    console.log('Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending revocation email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return false;
  }
};

const sendTerminationEmail = async (email, firstName) => {
  const messageTemplate = `Dear ${firstName},

We regret to inform you that your Solo Parent ID has been terminated by the Department of Social Welfare and Development (DSWD).

Your Solo Parent ID is no longer valid, and you will no longer be eligible for the benefits and services provided to solo parents under the Solo Parents Welfare Act.

If you believe this decision was made in error or if your circumstances have changed and you wish to reapply, please visit your Barangay Office for guidance on the necessary steps and requirements.

For any clarifications or assistance, please contact your Barangay Office or DSWD Office.

Best regards,
Department of Social Welfare and Development
Solo Parent Support Division`;

  const mailOptions = {
    from: 'santamariasoloparent@gmail.com',
    to: email,
    subject: "Important Notice: Solo Parent ID Termination",
    text: messageTemplate
  };

  try {
    console.log(`Attempting to send termination email to: ${email}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Termination email sent successfully to:', email);
    console.log('Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending termination email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return false;
  }
};

const sendReverificationEmail = async (email, firstName) => {
  const messageTemplate = `Dear ${firstName},

We are pleased to inform you that your Solo Parent ID has been re-verified by the Department of Social Welfare and Development (DSWD).

Your Solo Parent ID is now active again, and you are eligible for all benefits and services provided to solo parents under the Solo Parents Welfare Act.

You may visit your respective Barangay Office if you need to obtain a physical copy of your Solo Parent ID.

For any inquiries or assistance, please contact your Barangay Office or DSWD Office.

Best regards,
Department of Social Welfare and Development
Solo Parent Support Division`;

  const mailOptions = {
    from: 'santamariasoloparent@gmail.com',
    to: email,
    subject: "Good News: Solo Parent ID Re-verified",
    text: messageTemplate
  };

  try {
    console.log(`Attempting to send re-verification email to: ${email}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Re-verification email sent successfully to:', email);
    console.log('Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending re-verification email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    return false;
  }
};

// Verify email configuration on startup and log the result
transporter.verify()
  .then(() => console.log('Email service is ready to send messages'))
  .catch(err => {
    console.error('Email service error:', err);
    console.error('Email configuration:', {
      service: 'gmail',
      user: process.env.EMAIL_USER ? process.env.EMAIL_USER.substring(0, 5) + '...' : 'not set',
      pass: process.env.EMAIL_APP_PASSWORD ? 'is set (hidden)' : 'not set'
    });
  });

module.exports = {
  sendStatusEmail,
  sendRenewalStatusEmail,
  sendRevokeEmail,
  sendTerminationEmail,
  sendReverificationEmail
};