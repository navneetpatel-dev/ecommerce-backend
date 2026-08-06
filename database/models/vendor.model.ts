import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Vendor extends Model<InferAttributes<Vendor>, InferCreationAttributes<Vendor>> {
  declare id: CreationOptional<string>;
  declare businessName: string;
  declare slug: string;
  declare gstNumber: string | null;
  declare state: string | null;
  declare bankDetails: Record<string, unknown>;
  declare logoUrl: string | null;
  declare bannerUrl: string | null;
  declare description: string | null;
  declare status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  declare rejectionReason: string | null;
  declare suspensionReason: string | null;
  declare commissionRate: CreationOptional<number>;
  declare performanceScore: CreationOptional<number>;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    Vendor.hasMany(models.User, { foreignKey: 'vendorId' });
    Vendor.hasMany(models.Product, { foreignKey: 'vendorId' });
    Vendor.hasMany(models.VendorDocument, { foreignKey: 'vendorId' });
  }
}

export const initVendorModel = (sequelize: Sequelize) => {
  Vendor.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      businessName: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      gstNumber: { type: DataTypes.STRING, allowNull: true },
      state: { type: DataTypes.STRING, allowNull: true },
      bankDetails: { type: DataTypes.JSONB, allowNull: false },
      logoUrl: { type: DataTypes.STRING, allowNull: true },
      bannerUrl: { type: DataTypes.STRING, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'), defaultValue: 'PENDING' },
      rejectionReason: { type: DataTypes.TEXT, allowNull: true },
      suspensionReason: { type: DataTypes.TEXT, allowNull: true },
      commissionRate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 10.0 },
      performanceScore: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'vendors', timestamps: true, paranoid: true },
  );
  return Vendor;
};
