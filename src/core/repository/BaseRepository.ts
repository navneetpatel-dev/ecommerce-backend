import { Model, ModelStatic, WhereOptions, FindOptions, CreationAttributes, Transaction } from 'sequelize';

export interface RepositoryOptions {
  transaction?: Transaction;
}

export class BaseRepository<M extends Model> {
  constructor(protected readonly model: ModelStatic<M>) {}

  findById(id: string, options?: FindOptions<M>) {
    return this.model.findByPk(id, options);
  }

  findOne(where: WhereOptions<M>, options?: Omit<FindOptions<M>, 'where'>) {
    return this.model.findOne({ where, ...options });
  }

  findMany(options?: FindOptions<M>) {
    return this.model.findAll(options);
  }

  create(data: CreationAttributes<M>, options?: RepositoryOptions) {
    return this.model.create(data as any, { transaction: options?.transaction });
  }

  update(id: string, data: Partial<CreationAttributes<M>>, options?: RepositoryOptions) {
    return this.model.update(data as any, { 
      where: { id } as any, 
      transaction: options?.transaction 
    });
  }

  delete(id: string, options?: RepositoryOptions) {
    return this.model.destroy({ 
      where: { id } as any, 
      transaction: options?.transaction 
    });
  }

  // soft delete - marks as deleted but keeps in db
  softDelete(id: string, options?: RepositoryOptions) {
    return this.model.destroy({ 
      where: { id } as any, 
      transaction: options?.transaction 
    });
  }

  // hard delete - actually removes from db
  forceDelete(id: string, options?: RepositoryOptions) {
    return this.model.destroy({ 
      where: { id } as any, 
      force: true,
      transaction: options?.transaction 
    });
  }

  // restore soft deleted record
  restore(id: string, options?: RepositoryOptions) {
    return this.model.restore({ 
      where: { id } as any, 
      transaction: options?.transaction 
    });
  }
}
