import {
  Model,
  ModelStatic,
  WhereOptions,
  FindOptions,
  CreationAttributes,
  Transaction,
  type Attributes,
  type CreateOptions,
} from 'sequelize';

export interface RepositoryOptions {
  transaction?: Transaction;
}

export class BaseRepository<M extends Model> {
  constructor(protected readonly model: ModelStatic<M>) {}

  /** Every model here is keyed by `id`, which a generic model type cannot express. */
  private byId(id: string): WhereOptions<Attributes<M>> {
    return { id } as unknown as WhereOptions<Attributes<M>>;
  }

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
    return this.model.create(data, { transaction: options?.transaction } as CreateOptions<Attributes<M>>);
  }

  update(id: string, data: Partial<CreationAttributes<M>>, options?: RepositoryOptions) {
    return this.model.update(data as Parameters<ModelStatic<M>['update']>[0], {
      where: this.byId(id),
      transaction: options?.transaction,
    });
  }

  delete(id: string, options?: RepositoryOptions) {
    return this.model.destroy({
      where: this.byId(id),
      transaction: options?.transaction,
    });
  }

  // soft delete - marks as deleted but keeps in db
  softDelete(id: string, options?: RepositoryOptions) {
    return this.model.destroy({
      where: this.byId(id),
      transaction: options?.transaction,
    });
  }

  // hard delete - actually removes from db
  forceDelete(id: string, options?: RepositoryOptions) {
    return this.model.destroy({
      where: this.byId(id),
      force: true,
      transaction: options?.transaction,
    });
  }

  // restore soft deleted record
  restore(id: string, options?: RepositoryOptions) {
    return this.model.restore({
      where: this.byId(id),
      transaction: options?.transaction,
    });
  }
}
