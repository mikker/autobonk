import z32 from 'z32'
import b4a from 'b4a'
import ReadyResource from 'ready-resource'
import Autobase from 'autobase'
import Hyperswarm from 'hyperswarm'
import HyperDB from 'hyperdb'
import BlindPairing from 'blind-pairing'

class ContextPairer extends ReadyResource {
  constructor (store, invite, opts = {}) {
    super()

    this.store = store
    this.invite = invite
    this.bootstrap = opts.bootstrap || null
    this.schema = opts.schema
    this.ContextClass = opts.ContextClass || Context
    this.swarm = null
    this.pairing = null
    this.candidate = null

    this.onresolve = null
    this.onreject = null

    this.context = null

    this.ready()
  }

  async _open () {
    await this.store.ready()

    if (!this.swarm) {
      this.swarm = new Hyperswarm({
        keyPair: await this.store.createKeyPair('hyperswarm'),
        bootstrap: this.bootstrap
      })
    }

    const store = this.store
    this.swarm.on('connection', (connection, peerInfo) => {
      store.replicate(connection)
    })

    this.pairing = new BlindPairing(this.swarm)

    const core = Autobase.getLocalCore(this.store)
    await core.ready()
    const key = core.key
    await core.close()

    this.candidate = this.pairing.addCandidate({
      invite: z32.decode(this.invite),
      userData: key,
      onadd: async (result) => {
        if (this.context === null) {
          this.context = new this.ContextClass(this.store, {
            swarm: this.swarm,
            key: result.key,
            encryptionKey: result.encryptionKey,
            bootstrap: this.bootstrap,
            schema: this.schema
          })
        }
        this.store = null
        if (this.onresolve) this._whenWritable()
        this.candidate.close().catch(() => {})
      }
    })
  }

  async _close () {
    if (this.candidate) await this.candidate.close()
    if (this.pairing) await this.pairing.close()
    if (this.swarm) await this.swarm.destroy()
    if (this.store) await this.store.close()

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    }
  }

  _whenWritable () {
    if (this.context.writable) {
      this.onresolve(this.context)
      return
    }

    const check = () => {
      if (this.context.writable) {
        this.context.base.off('update', check)
        this.onresolve(this.context)
      }
    }

    this.context.base.on('update', check)
  }

  resolve () {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

export class Context extends ReadyResource {
  constructor (store, opts = {}) {
    super()

    this.store = store

    this.base = null
    this.bootstrap = opts.bootstrap || null
    this.member = null
    this.pairing = null
    this.swarm = opts.swarm || null

    this.schema = opts.schema
    if (!this.schema.db || !this.schema.dispatch) {
      throw new Error('Needs schema { db, dispatch }')
    }

    const { Router } = this.schema.dispatch
    this.router = new Router()
    this._setupInternalRoutes()
    // Setup subclass routes
    if (typeof this.setupRoutes === 'function') this.setupRoutes()

    this._boot(opts)
    this.ready()
  }

  _boot (opts = {}) {
    const { key, encryptionKey } = opts
    const { db } = this.schema

    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      open (store) {
        return HyperDB.bee(store.get('view'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      apply: this._apply.bind(this)
    })

    this.base.on('update', () => {
      this.emit('update')
    })
  }

  async _open () {
    await this.base.ready()

    if (!this.swarm) {
      this.swarm = new Hyperswarm({
        keyPair: await this.store.createKeyPair('hyperswarm'),
        bootstrap: this.bootstrap
      })
    }

    this.swarm.on('connection', (connection, peerInfo) => {
      this.store.replicate(connection)
    })

    this.pairing = new BlindPairing(this.swarm)
    this.member = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (candidate) => {
        const id = candidate.inviteId
        const inv = await this.base.view.findOne('@autobonk/invite', {})

        if (inv === null || !b4a.equals(inv.id, id)) return

        candidate.open(inv.publicKey)

        await this.addWriter(candidate.userData)

        candidate.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey
        })
      }
    })

    this.swarm.join(this.base.discoveryKey)
  }

  async _close () {
    await this.member.close()
    await this.pairing.close()
    await this.swarm.destroy()
    await this.base.close()
  }

  async _apply (nodes, view, base) {
    for (const node of nodes) {
      await this.router.dispatch(node.value, { view, base })
    }
    await view.flush()
  }

  _setupInternalRoutes () {
    this.router.add('@autobonk/remove-writer', async (data, context) => {
      await context.base.removeWriter(data.key)
    })

    this.router.add('@autobonk/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })

    this.router.add('@autobonk/add-invite', async (data, context) => {
      await context.view.insert('@autobonk/invite', data)
    })
  }

  get writable () {
    return this.base.writable
  }

  get key () {
    return this.base.key
  }

  get discoveryKey () {
    return this.base.discoveryKey
  }

  get encryptionKey () {
    return this.base.encryptionKey
  }

  subscribe (cb) {
    this.on('update', cb)
    return () => this.off('update', cb)
  }

  async addWriter (key) {
    await this.base.append(
      this.schema.dispatch.encode('@autobonk/add-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      })
    )
    return true
  }

  async removeWriter (key) {
    await this.base.append(
      this.schema.dispatch.encode('@autobonk/remove-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      })
    )
    return true
  }

  static pair (store, invite, opts = {}) {
    return new ContextPairer(store, invite, { ...opts, ContextClass: this })
  }

  async createInvite () {
    await this.ready()

    const existing = await this.base.view.findOne('@autobonk/invite', {})
    if (existing) {
      return z32.encode(existing.invite)
    }

    const { id, invite, publicKey, expires } = BlindPairing.createInvite(
      this.base.key
    )
    const record = { id, invite, publicKey, expires }

    await this.base.append(
      this.schema.dispatch.encode('@autobonk/add-invite', record)
    )

    return z32.encode(record.invite)
  }
}
