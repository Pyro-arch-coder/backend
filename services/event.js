const { queryDatabase } = require('../database');

const EventService = {
  checkAttendance: async (eventId, userId) => {
    try {
      console.log('Checking attendance for:', { eventId, userId });
      
      // Query to check if the user has attended the event
      const query = `
        SELECT id 
        FROM attendees 
        WHERE event_id = ? AND code_id = ?
      `;
      
      const result = await queryDatabase(query, [eventId, userId]);
      console.log('Attendance check result:', result);
      
      // Return true if there's a matching record, false otherwise
      return {
        attended: Array.isArray(result) && result.length > 0
      };
    } catch (error) {
      console.error('Database error in checkAttendance:', error);
      throw error;
    }
  },

  addAttendee: async (eventId, userId) => {
    try {
      console.log('Adding attendee:', { eventId, userId });
      
      // First check if the user is already an attendee
      const exists = await EventService.checkAttendance(eventId, userId);
      if (exists) {
        return { success: false, message: 'User is already an attendee' };
      }

      // Add the attendee
      const result = await queryDatabase(
        `INSERT INTO attendees (event_id, user_id, created_at) 
         VALUES (?, ?, NOW())`,
        [eventId, userId]
      );

      console.log('Add attendee result:', result);
      return { success: true, message: 'Attendee added successfully' };
    } catch (error) {
      console.error('Database error in addAttendee:', error);
      throw error;
    }
  },

  getAttendees: async (eventId) => {
    try {
      const query = `SELECT * FROM attendees WHERE event_id = ?`;
      const result = await queryDatabase(query, [eventId]);
      return result;
    } catch (error) {
      console.error('Database error in getAttendees:', error);
      throw error;
    }
  }
};

module.exports = EventService;
