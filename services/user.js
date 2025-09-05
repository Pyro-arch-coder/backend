const { queryDatabase } = require('../database');

const UserService = {
  searchUsers: async (query) => {
    try {
      const results = await queryDatabase(
        `SELECT id, name, email FROM users 
         WHERE name LIKE ? OR email LIKE ?`,
        [`%${query}%`, `%${query}%`]
      );
      return results || [];
    } catch (error) {
      console.error('Search error:', error);
      throw error;
    }
  }
};

module.exports = UserService;
