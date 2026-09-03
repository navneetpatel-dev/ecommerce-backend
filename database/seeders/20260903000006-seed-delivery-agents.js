'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

const AGENTS = [
  { email: 'agent.north@ecommerce.com', fullName: 'Ravi Kumar', phone: '9800000001', hubOrZone: 'NORTH-HUB', vehicleType: 'BIKE' },
  { email: 'agent.south@ecommerce.com', fullName: 'Priya Singh', phone: '9800000002', hubOrZone: 'SOUTH-HUB', vehicleType: 'SCOOTER' },
  { email: 'agent.east@ecommerce.com', fullName: 'Arjun Das', phone: '9800000003', hubOrZone: 'EAST-HUB', vehicleType: 'BIKE' },
];

module.exports = {
  async up(queryInterface) {
    const [roles] = await queryInterface.sequelize.query(
      `SELECT id FROM roles WHERE name = 'DELIVERY_AGENT' LIMIT 1`,
    );
    const role = roles[0];
    if (!role) return;

    const now = new Date();
    const passwordHash = await bcrypt.hash(
      process.env.DELIVERY_AGENT_SEED_PASSWORD || 'Delivery@123',
      12,
    );

    for (const definition of AGENTS) {
      const [users] = await queryInterface.sequelize.query(
        `SELECT id FROM users WHERE email = :email LIMIT 1`,
        { replacements: { email: definition.email } },
      );
      if (users.length) continue;

      const userId = uuidv4();
      const agentId = uuidv4();
      await queryInterface.bulkInsert('users', [{
        id: userId,
        email: definition.email,
        passwordHash,
        name: definition.fullName,
        phone: definition.phone,
        status: 'ACTIVE',
        roleId: role.id,
        vendorId: null,
        deliveryAgentId: null,
        emailVerified: true,
        emailMarketingConsent: false,
        emailSuppressed: false,
        createdAt: now,
        updatedAt: now,
      }]);
      await queryInterface.bulkInsert('delivery_agents', [{
        id: agentId,
        userId,
        fullName: definition.fullName,
        phone: definition.phone,
        vehicleType: definition.vehicleType,
        hubOrZone: definition.hubOrZone,
        status: 'ACTIVE',
        availableForAssignment: true,
        createdAt: now,
        updatedAt: now,
      }]);
      await queryInterface.sequelize.query(
        `UPDATE users SET "deliveryAgentId" = :agentId WHERE id = :userId`,
        { replacements: { agentId, userId } },
      );
    }
  },

  async down(queryInterface) {
    const emails = AGENTS.map((agent) => agent.email);
    const [users] = await queryInterface.sequelize.query(
      `SELECT id, "deliveryAgentId" FROM users WHERE email IN (:emails)`,
      { replacements: { emails } },
    );
    await queryInterface.bulkDelete('users', { email: emails }, {});
    const agentIds = users.map((user) => user.deliveryAgentId).filter(Boolean);
    if (agentIds.length) await queryInterface.bulkDelete('delivery_agents', { id: agentIds }, {});
  },
};
