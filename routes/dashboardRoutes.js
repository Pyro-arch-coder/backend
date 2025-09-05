const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database connection

// Get dashboard data for a specific barangay
router.get('/dashboard/data/:barangay', async (req, res) => {
  try {
    const { barangay } = req.params;
    
    // Get monthly population counts for the past 12 months
    const populationQuery = `
      SELECT MONTH(created_at) as month, COUNT(*) as count
      FROM users
      WHERE barangay = ? AND status = 'Verified'
      AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY MONTH(created_at)
      ORDER BY month
    `;
    
    // Get age distribution
    const ageDistributionQuery = `
      SELECT 
        CASE 
          WHEN age BETWEEN 0 AND 18 THEN '0-18'
          WHEN age BETWEEN 19 AND 30 THEN '19-30'
          WHEN age BETWEEN 31 AND 45 THEN '31-45'
          WHEN age BETWEEN 46 AND 60 THEN '46-60'
          ELSE '60+'
        END as age_group,
        COUNT(*) as count
      FROM users
      WHERE barangay = ? AND status = 'Verified'
      GROUP BY age_group
      ORDER BY 
        CASE age_group
          WHEN '0-18' THEN 1
          WHEN '19-30' THEN 2
          WHEN '31-45' THEN 3
          WHEN '46-60' THEN 4
          WHEN '60+' THEN 5
        END
    `;
    
    // Get gender distribution
    const genderDistributionQuery = `
      SELECT gender as name, COUNT(*) as value
      FROM users
      WHERE barangay = ? AND status = 'Verified'
      GROUP BY gender
    `;
    
    // Get classification distribution
    const classificationDistributionQuery = `
      SELECT classification as name, COUNT(*) as value
      FROM users
      WHERE barangay = ? AND status = 'Verified'
      GROUP BY classification
      ORDER BY value DESC
    `;
    
    // Get monthly registrations for the past 12 months
    const monthlyRegistrationsQuery = `
      SELECT MONTH(created_at) as month, COUNT(*) as count
      FROM users
      WHERE barangay = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY MONTH(created_at)
      ORDER BY month
    `;
    
    // Execute all queries
    const [
      populationResults,
      ageDistributionResults,
      genderDistributionResults,
      classificationDistributionResults,
      monthlyRegistrationsResults
    ] = await Promise.all([
      db.query(populationQuery, [barangay]),
      db.query(ageDistributionQuery, [barangay]),
      db.query(genderDistributionQuery, [barangay]),
      db.query(classificationDistributionQuery, [barangay]),
      db.query(monthlyRegistrationsQuery, [barangay])
    ]);
    
    // Process population data to fill in missing months
    const populationByMonth = new Array(12).fill(0);
    populationResults.forEach(row => {
      const monthIndex = (row.month - 1) % 12;
      populationByMonth[monthIndex] = row.count;
    });
    
    // Process monthly registrations data to fill in missing months
    const registrationsByMonth = new Array(12).fill(0);
    monthlyRegistrationsResults.forEach(row => {
      const monthIndex = (row.month - 1) % 12;
      registrationsByMonth[monthIndex] = row.count;
    });
    
    // Format the response
    const dashboardData = {
      population: populationByMonth,
      ageDistribution: ageDistributionResults,
      genderDistribution: genderDistributionResults,
      classificationDistribution: classificationDistributionResults,
      monthlyRegistrations: registrationsByMonth
    };
    
    res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get admin information including assigned barangay
router.get('/admin/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT id, username, barangay, role
      FROM users
      WHERE id = ? AND role = 'admin'
    `;
    
    const [admin] = await db.query(query, [id]);
    
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    
    res.json(admin);
  } catch (error) {
    console.error('Error fetching admin info:', error);
    res.status(500).json({ error: 'Failed to fetch admin information' });
  }
});

module.exports = router; 