export type TDatabaseDataType = string | boolean | number | Blob;

export type TDatabaseStructure = {
  name: string;
  options?: Partial<{
    key: boolean;
    index: boolean;
    unique: boolean;
    multiEntry: boolean;
  }>;
};

export type TDatabase = {
  structures: TDatabaseStructure[];
  autoIncrement?: boolean;
};

export type TDatabaseData = {
  [x: string]: TDatabaseDataType | TDatabaseDataType[];
};

export default class Database<TData> {
  readonly name: string;
  readonly version: number;

  private db!: IDBDatabase;
  private isReady = false;

  constructor(name: string, version: number, options: TDatabase) {
    this.name = name;
    this.version = version;

    const request = window.indexedDB.open(this.name, this.version);

    request.onsuccess = () => {
      const { result } = request;
      if (!result) return;

      this.db = result;
      if (this.db.version === version) this.isReady = true;
    };

    request.onerror = (e) => {
      throw e as unknown as Error;
    };

    request.onupgradeneeded = () => {
      this.db = request.result;

      const indexes: TDatabaseStructure[] = [];
      let keyPath = null;

      for (const structure of options.structures) {
        const { options } = structure;
        if (!options) continue;

        if (options.key) keyPath = structure.name;
        else if (options.index) indexes.push(structure);
      }

      const objectOptions = { keyPath: keyPath, autoIncrement: options.autoIncrement };
      const store = this.db.createObjectStore(this.name, objectOptions);

      for (const index of indexes) {
        store.createIndex(index.name, index.name, {
          unique: index.options!.unique,
          multiEntry: index.options!.multiEntry,
        });
      }

      this.isReady = true;
    };
  }

  add(data: TData) {
    return new Promise((res, rej) => {
      this.wait().then(() => {
        const { db } = this;

        const transaction = db.transaction([this.name], 'readwrite');
        const store = transaction.objectStore(this.name);

        transaction.oncomplete = () => {
          res(transaction);
        };
        transaction.onerror = (e) => {
          rej(e);
        };

        store.add(data);
      });
    });
  }

  delete(index: string | number): Promise<void> {
    return new Promise((res, rej) => {
      this.wait().then(() => {
        const { db } = this;

        const transaction = db.transaction([this.name], 'readwrite');
        const store = transaction.objectStore(this.name);
        const request = store.delete(index);

        request.onsuccess = () => {
          res(request.result);
        };
        request.onerror = (e) => {
          rej(e);
        };
      });
    });
  }

  get(index: string | number, key?: string): Promise<TData | null> {
    return new Promise((res, rej) => {
      this.wait().then(() => {
        const { db } = this;

        const transaction = db.transaction([this.name], 'readonly');
        const store = transaction.objectStore(this.name);
        const request = key ? store.index(key).get(index) : store.get(index);

        request.onsuccess = () => {
          res((request.result as TData) || null);
        };
        request.onerror = (e) => {
          rej(e);
        };
      });
    });
  }

  getAll(): Promise<TData[]> {
    return new Promise((res, rej) => {
      this.wait()
        .then(() => {
          const { db } = this;
          const result: TData[] = [];

          const transaction = db.transaction([this.name], 'readonly');
          const store = transaction.objectStore(this.name);
          const cursor = store.openCursor();

          cursor.onsuccess = (e) => {
            const _cur = (e.target as IDBRequest).result as IDBCursorWithValue | null;
            if (_cur) {
              result.push(_cur.value as TData);
              _cur.continue();
            } else {
              res(result);
            }
          };

          cursor.onerror = (e) => {
            rej(e);
          };
        })
        .catch(rej);
    });
  }

  update(index: string | number, data: TData): Promise<TData> {
    return new Promise((res, rej) => {
      this.wait().then(() => {
        const { db } = this;

        const transaction = db.transaction([this.name], 'readwrite');
        const store = transaction.objectStore(this.name);
        const request = store.get(index);

        request.onsuccess = () => {
          const oldData = request.result as TData;
          const newData = { ...oldData, ...data };

          const reqUpdate = store.put(newData);
          reqUpdate.onsuccess = () => {
            res(newData);
          };
          reqUpdate.onerror = (e) => {
            rej(e);
          };
        };
        request.onerror = (e) => {
          rej(e);
        };
      });
    });
  }

  private wait() {
    return new Promise((res) => {
      if (this.isReady) return res(this.isReady);
      const clockId = setInterval(() => {
        if (!this.isReady) return;
        res(this.isReady);
        clearInterval(clockId);
      }, 200);
    });
  }
}
