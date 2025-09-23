import Corestore from 'corestore'
import Hyperbee from 'hyperbee'
import { join } from 'path'
import ReadyResource from 'ready-resource'

export class Manager extends ReadyResource {
  constructor(baseDir, opts = {}) {
    super()

    if (!opts.ContextClass) {
      throw new Error('Manager requires ContextClass option')
    }

    if (!opts.schema) {
      throw new Error('Manager requires schema option')
    }

    this.baseDir = baseDir
    this.ContextClass = opts.ContextClass
    this.schema = opts.schema
    this.bootstrap = opts.bootstrap || null
    this.autobase = opts.autobase || null
    this.corestore = new Corestore(join(baseDir, 'contexts'))
    this.localDb = null
    this.contexts = new Map()
    this.pendingContexts = new Map()

    this.ready()
  }

  async _open() {
    await this.corestore.ready()

    const localCore = this.corestore.get({ name: 'local' })
    await localCore.ready()
    this.localDb = new Hyperbee(localCore, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    await this.localDb.ready()
  }

  async _close() {
    await Promise.all(this.contexts.values().map((context) => context.close()))

    this.contexts.clear()
    this.pendingContexts.clear()

    if (this.localDb) await this.localDb.close()
    if (this.corestore) await this.corestore.close()
  }

  async createContext(opts = {}) {
    await this.ready()

    const contextStore = this.corestore.namespace(`ctx-${Date.now()}`)
    const context = new this.ContextClass(contextStore, {
      schema: this.schema,
      bootstrap: this.bootstrap,
      autobase: this.autobase
    })
    await context.ready()

    const keyHex = context.key.toString('hex')
    const now = Date.now()
    const contextRecord = {
      key: keyHex,
      encryptionKey: context.encryptionKey.toString('hex'),
      name: opts.name || `Context ${keyHex.slice(0, 8)}`,
      createdAt: now,
      isCreator: true,
      namespace: `ctx-${keyHex.slice(0, 16)}`
    }

    await this.localDb.put(`contexts/${keyHex}`, contextRecord)

    await context.close()

    const finalStore = this.corestore.namespace(contextRecord.namespace)
    const finalContext = new this.ContextClass(finalStore, {
      schema: this.schema,
      key: context.key,
      encryptionKey: context.encryptionKey,
      bootstrap: this.bootstrap,
      autobase: this.autobase
    })

    await finalContext.ready()

    this.contexts.set(keyHex, finalContext)

    return finalContext
  }

  async joinContext(invite, opts = {}) {
    await this.ready()

    const tempStore = this.corestore.namespace(`temp-join-${Date.now()}`)
    const pairer = this.ContextClass.pair(tempStore, invite, {
      schema: this.schema,
      bootstrap: this.bootstrap,
      autobase: this.autobase
    })
    const tempContext = await pairer.resolve()
    await tempContext.ready()

    const key = tempContext.key
    const encryptionKey = tempContext.encryptionKey
    const keyHex = key.toString('hex')

    await tempContext.close()

    const finalNamespace = `ctx-${keyHex.slice(0, 16)}`
    const finalStore = this.corestore.namespace(finalNamespace)
    const context = new this.ContextClass(finalStore, {
      schema: this.schema,
      key,
      encryptionKey,
      bootstrap: this.bootstrap,
      autobase: this.autobase
    })
    await context.ready()

    const now = Date.now()
    const contextRecord = {
      key: keyHex,
      encryptionKey: encryptionKey.toString('hex'),
      name: opts.name || `Context ${keyHex.slice(0, 8)}`,
      createdAt: now,
      isCreator: false,
      namespace: finalNamespace
    }

    await this.localDb.put(`contexts/${keyHex}`, contextRecord)

    this.contexts.set(keyHex, context)

    return context
  }

  async getContext(keyHex) {
    await this.ready()

    if (this.contexts.has(keyHex)) {
      const context = this.contexts.get(keyHex)
      return context
    }

    // Return existing promise if we're already initializing
    if (this.pendingContexts.has(keyHex)) {
      return await this.pendingContexts.get(keyHex)
    }

    const contextPromise = this._loadContext(keyHex)
    this.pendingContexts.set(keyHex, contextPromise)

    try {
      const context = await contextPromise
      this.pendingContexts.delete(keyHex)
      return context
    } catch (error) {
      this.pendingContexts.delete(keyHex)
      throw error
    }
  }

  async _loadContext(keyHex) {
    const contextRecordRaw = await this.localDb.get(`contexts/${keyHex}`)
    if (!contextRecordRaw) {
      return null
    }

    const contextRecord = contextRecordRaw.value || contextRecordRaw

    const namespace = contextRecord.namespace || `ctx-${keyHex.slice(0, 16)}`
    const contextStore = this.corestore.namespace(namespace)
    const key = Buffer.from(keyHex, 'hex')

    if (!contextRecord.encryptionKey) {
      throw new Error(`Context record missing encryptionKey for ${keyHex}`)
    }

    const encryptionKey = Buffer.isBuffer(contextRecord.encryptionKey)
      ? contextRecord.encryptionKey
      : Buffer.from(contextRecord.encryptionKey, 'hex')

    const context = new this.ContextClass(contextStore, {
      schema: this.schema,
      key,
      encryptionKey,
      bootstrap: this.bootstrap,
      autobase: this.autobase
    })
    await context.ready()

    this.contexts.set(keyHex, context)

    return context
  }

  async listContexts() {
    await this.ready()

    const contexts = []
    for await (const { value } of this.localDb.createReadStream({
      gte: 'contexts/',
      lt: 'contexts/~'
    })) {
      contexts.push(value)
    }

    return contexts.sort((a, b) => b.createdAt - a.createdAt)
  }

  async removeContext(keyHex) {
    await this.ready()

    const contextRecordRaw = await this.localDb.get(`contexts/${keyHex}`)
    if (!contextRecordRaw) {
      return false
    }

    if (this.contexts.has(keyHex)) {
      const context = this.contexts.get(keyHex)
      try {
        await context.close()
      } catch (err) {
        // noop
      }
      this.contexts.delete(keyHex)
    }

    await this.localDb.del(`contexts/${keyHex}`)

    return true
  }
}
