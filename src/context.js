import z32 from 'z32'
import b4a from 'b4a'
import ReadyResource from 'ready-resource'
import Autobase from 'autobase'
import Hyperswarm from 'hyperswarm'
import HyperDB from 'hyperdb'
import BlindPairing from 'blind-pairing'

const OWNER_ROLE_NAME = 'owner'
const OWNER_PERMISSIONS = [
  'role:create',
  'role:assign',
  'role:revoke',
  'user:invite',
  'user:remove'
]

class PermissionError extends Error {
  constructor(message, requiredPermission, subjectKey) {
    super(message)
    this.name = 'PermissionError'
    this.requiredPermission = requiredPermission
    this.subjectKey = subjectKey
  }
}

class ContextPairer extends ReadyResource {
  constructor(store, invite, opts = {}) {
    super()

    this.store = store
    this.invite = invite
    this.bootstrap = opts.bootstrap || null
    this.autobase = opts.autobase || null
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

  async _open() {
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
            schema: this.schema,
            autobase: this.autobase
          })
        }
        this.store = null
        if (this.onresolve) this._whenWritable()
        this.candidate.close().catch(noop)
      }
    })
  }

  async _close() {
    if (this.candidate) await this.candidate.close()
    if (this.pairing) await this.pairing.close()
    if (this.swarm) await this.swarm.destroy()
    if (this.store) await this.store.close()

    if (this.onreject) {
      this.onreject(new Error('Pairing closed'))
    }
  }

  _whenWritable() {
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

  resolve() {
    return new Promise((resolve, reject) => {
      this.onresolve = resolve
      this.onreject = reject
    })
  }
}

export class Context extends ReadyResource {
  constructor(store, opts = {}) {
    super()

    this.store = store

    this.base = null
    this.bootstrap = opts.bootstrap || null
    this.member = null
    this.pairing = null
    this.swarm = opts.swarm || null
    this.autobaseOptions = opts.autobase || {}
    this._resourcesReady = false

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

  _boot(opts = {}) {
    const { key, encryptionKey } = opts
    const { db } = this.schema

    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      open(store) {
        return HyperDB.bee(store.get('view'), db, {
          extension: false,
          autoUpdate: true
        })
      },
      apply: this._apply.bind(this),
      ...this.autobaseOptions
    })

    this.base.on('update', () => {
      this.emit('update')
    })
  }

  async _open() {
    await this.base.ready()
    await this._maybeInitContext()
    await this._maybeSetupResources()

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
        const inv = await this.base.view.get('@autobonk/invite', { id })

        if (!inv) {
          return
        }

        const openAndDeny = async (status) => {
          try {
            candidate.open(inv.publicKey)
            candidate.deny({ status })
          } catch (_) {
            // If we cannot open the invite we cannot craft a reply.
          }
        }

        if (inv.revokedAt) {
          await openAndDeny(2)
          return
        }

        if (inv.expires && inv.expires > 0 && inv.expires <= Date.now()) {
          await openAndDeny(3)
          return
        }

        try {
          await this.requirePermission(this.writerKey, 'user:invite')
        } catch (err) {
          if (err instanceof PermissionError) {
            await openAndDeny(1)
            return
          }
          throw err
        }

        let userData
        try {
          userData = candidate.open(inv.publicKey)
        } catch (_) {
          return
        }

        await this.addWriter(userData)

        if (Array.isArray(inv.roles) && inv.roles.length > 0) {
          await this.grantRoles(userData, inv.roles)
        }

        candidate.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey
        })
      }
    })

    this.swarm.join(this.base.discoveryKey)
  }

  async _close() {
    await this._maybeTeardownResources()

    if (this.member) await this.member.close()
    if (this.pairing) await this.pairing.close()
    if (this.swarm) await this.swarm.destroy()
    if (this.base) await this.base.close()
  }

  async _apply(nodes, view, base) {
    for (const node of nodes) {
      await this.router.dispatch(node.value, {
        view,
        base,
        writerKey: node.from.key,
        blockIndex: node.length - 1
      })
    }
    await view.flush()
  }

  get writable() {
    return this.base.writable
  }

  get key() {
    return this.base.key
  }

  get discoveryKey() {
    return this.base.discoveryKey
  }

  get writerKey() {
    return this.base.local.key // unique per participant
  }

  get contextKey() {
    return this.base.key // same for everyone
  }

  get encryptionKey() {
    return this.base.encryptionKey
  }

  static pair(store, invite, opts = {}) {
    return new ContextPairer(store, invite, { ...opts, ContextClass: this })
  }

  async _maybeSetupResources() {
    if (this._resourcesReady) return
    if (typeof this.setupResources !== 'function') return

    try {
      await this.setupResources()
      this._resourcesReady = true
    } catch (err) {
      try {
        if (typeof this.teardownResources === 'function') {
          await this.teardownResources()
        }
      } catch (_) {}
      throw err
    }
  }

  async _maybeTeardownResources() {
    if (!this._resourcesReady) return
    if (typeof this.teardownResources !== 'function') {
      this._resourcesReady = false
      return
    }

    try {
      await this.teardownResources()
    } finally {
      this._resourcesReady = false
    }
  }

  subscribe(cb) {
    this.on('update', cb)
    return () => this.off('update', cb)
  }

  async hasPermission(subjectKey, permission, blockIndex = null) {
    if (blockIndex === null) {
      blockIndex = this.base.length
    }

    const aclEntry = await this.base.view.get('@autobonk/acl-entry', {
      subjectKey
    })

    if (!aclEntry) {
      return false // No ACL entry = no permissions
    }

    for (const roleName of aclEntry.roles) {
      const roleDef = await this.base.view.get('@autobonk/role-def', {
        name: roleName
      })

      if (roleDef && roleDef.permissions.includes(permission)) {
        return true
      }
    }

    return false
  }

  async requirePermission(subjectKey, permission) {
    // Skip validation during initial sync before context is initialized
    const contextInit = await this.base.view.findOne('@autobonk/context-init', {})
    if (!contextInit) {
      return
    }

    const hasAccess = await this.hasPermission(subjectKey, permission)
    if (!hasAccess) {
      throw new PermissionError(`Missing permission: ${permission}`, permission, subjectKey)
    }
  }

  async defineRole(name, permissions, actorKey = null, opts = {}) {
    const actor = actorKey || this.writerKey
    await this.requirePermission(actor, 'role:create')

    const base = opts.base || this.base
    const view = opts.view || this.base.view

    // Get current revision for this role
    const existing = await view.get('@autobonk/role-def', { name })
    const rev = existing ? existing.rev + 1 : 1

    const permissionsArray = Array.isArray(permissions) ? permissions : [permissions]

    await this._appendOrApply({
      base,
      view,
      dispatch: '@autobonk/define-role',
      collection: '@autobonk/role-def',
      record: {
        name,
        permissions: permissionsArray,
        rev
      },
      opts
    })
  }

  async grantRoles(subjectKey, roles, actorKey = null, opts = {}) {
    const actor = actorKey || this.writerKey
    await this.requirePermission(actor, 'role:assign')

    if (!Buffer.isBuffer(subjectKey)) {
      throw new Error('subjectKey must be a Buffer')
    }

    const base = opts.base || this.base
    const view = opts.view || this.base.view

    const existing = await view.get('@autobonk/acl-entry', { subjectKey })
    const rev = existing ? existing.rev + 1 : 1

    const rolesArray = Array.isArray(roles) ? roles : [roles]

    for (const role of rolesArray) {
      if (typeof role !== 'string') {
        throw new Error(`Role must be a string, got ${typeof role}: ${role}`)
      }
    }

    await this._appendOrApply({
      base,
      view,
      dispatch: '@autobonk/grant-roles',
      collection: '@autobonk/acl-entry',
      record: {
        subjectKey,
        roles: rolesArray,
        rev
      },
      opts
    })
  }

  async revokeRoles(subjectKey) {
    await this.requirePermission(this.writerKey, 'role:revoke')

    if (!Buffer.isBuffer(subjectKey)) {
      throw new Error('subjectKey must be a Buffer')
    }

    const existing = await this.base.view.get('@autobonk/acl-entry', {
      subjectKey
    })
    const rev = existing ? existing.rev + 1 : 1

    await this.base.append(
      this.schema.dispatch.encode('@autobonk/revoke-roles', {
        subjectKey,
        roles: [], // Empty array = revocation
        rev,
        index: this.base.length,
        timestamp: Date.now()
      })
    )
  }

  async denounceRole(roleName, actorKey = null) {
    const actor = actorKey || this.writerKey

    if (typeof roleName !== 'string' || roleName.length === 0) {
      throw new Error('roleName must be a non-empty string')
    }

    await this.requirePermission(actor, 'role:revoke')

    if (!Buffer.isBuffer(actor)) {
      throw new Error('actorKey must be a Buffer')
    }

    const existing = await this.base.view.get('@autobonk/acl-entry', {
      subjectKey: actor
    })

    if (!existing || !existing.roles.includes(roleName)) {
      return false
    }

    const remainingRoles = existing.roles.filter((role) => role !== roleName)
    const rev = existing.rev + 1

    if (remainingRoles.length === 0) {
      await this._appendOrApply({
        base: this.base,
        view: this.base.view,
        dispatch: '@autobonk/revoke-roles',
        collection: '@autobonk/acl-entry',
        record: {
          subjectKey: actor,
          roles: [],
          rev
        }
      })
      return true
    }

    await this._appendOrApply({
      base: this.base,
      view: this.base.view,
      dispatch: '@autobonk/grant-roles',
      collection: '@autobonk/acl-entry',
      record: {
        subjectKey: actor,
        roles: remainingRoles,
        rev
      }
    })

    return true
  }

  async getRole(name) {
    return await this.base.view.get('@autobonk/role-def', { name })
  }

  async getRoles(subjectKey) {
    if (!Buffer.isBuffer(subjectKey)) {
      throw new Error('subjectKey must be a Buffer')
    }

    const aclEntry = await this.base.view.get('@autobonk/acl-entry', {
      subjectKey
    })
    return aclEntry ? aclEntry.roles : []
  }

  async addWriter(key, meta = {}) {
    const writerKey = b4a.isBuffer(key) ? key : b4a.from(key)

    if (!b4a.isBuffer(writerKey)) {
      throw new Error('Writer key must be a Buffer or Uint8Array')
    }

    let isIndexer = true

    if (meta && meta.isIndexer !== undefined) {
      isIndexer = meta.isIndexer
    }

    const record = {
      key: writerKey,
      isIndexer
    }

    await this.base.append(this.schema.dispatch.encode('@autobonk/add-writer', record))
    return true
  }

  async removeWriter(key) {
    await this.base.append(
      this.schema.dispatch.encode('@autobonk/remove-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      })
    )
    return true
  }

  async listInvites(opts = {}) {
    await this.ready()

    await this.requirePermission(this.writerKey, 'user:invite')

    const includeRevoked = opts.includeRevoked === true
    const invites = await this.base.view.find('@autobonk/invite', {}).toArray()

    if (includeRevoked) return invites

    return invites.filter((inv) => !inv.revokedAt)
  }

  async revokeInvite(id) {
    await this.ready()

    await this.requirePermission(this.writerKey, 'user:invite')

    if (!b4a.isBuffer(id)) {
      throw new Error('Invite id must be a Buffer')
    }

    const inviteId = id
    const existing = await this.base.view.get('@autobonk/invite', {
      id: inviteId
    })

    if (!existing || existing.revokedAt) {
      return false
    }

    const revokedAt = Date.now()

    await this.base.append(
      this.schema.dispatch.encode('@autobonk/revoke-invite', {
        id: inviteId,
        revokedAt
      })
    )

    return true
  }

  async createInvite(options = {}) {
    await this.ready()

    await this.requirePermission(this.writerKey, 'user:invite')

    const opts = options || {}
    const roles = opts.roles || []

    if (!Array.isArray(roles)) {
      throw new Error('Invite roles must be an array of strings')
    }

    for (const role of roles) {
      if (typeof role !== 'string') {
        throw new Error('Invite roles must be strings')
      }
    }

    const expires = opts.expires
    if (expires !== undefined && typeof expires !== 'number') {
      throw new Error('Invite expires must be a number when provided')
    }

    const invitePayload = BlindPairing.createInvite(this.base.key, {
      expires: typeof expires === 'number' ? expires : undefined
    })

    const { id, invite, publicKey, expires: defaultExpires } = invitePayload

    const record = {
      id,
      invite,
      publicKey,
      expires: typeof expires === 'number' ? expires : defaultExpires,
      roles,
      createdBy: this.writerKey,
      createdAt: Date.now()
    }

    await this.base.append(this.schema.dispatch.encode('@autobonk/add-invite', record))

    return z32.encode(invite)
  }

  _setupInternalRoutes() {
    this.router.add('@autobonk/remove-writer', async (data, context) => {
      await this.requirePermission(context.writerKey, 'user:remove')
      await context.base.removeWriter(data.key)
    })

    this.router.add('@autobonk/add-writer', async (data, context) => {
      await this.requirePermission(context.writerKey, 'user:invite')

      const isIndexer = data.isIndexer === undefined ? true : data.isIndexer

      await context.base.addWriter(data.key, { isIndexer })
    })

    this.router.add('@autobonk/add-invite', async (data, context) => {
      await this.requirePermission(context.writerKey, 'user:invite')

      if (!b4a.isBuffer(data.id)) {
        throw new Error('Invite id must be a Buffer')
      }

      if (!b4a.isBuffer(data.createdBy)) {
        throw new Error('Invite createdBy must be a Buffer')
      }

      if (typeof data.createdAt !== 'number') {
        throw new Error('Invite createdAt must be a number')
      }

      if (!Array.isArray(data.roles)) {
        throw new Error('Invite roles must be an array')
      }

      for (const role of data.roles) {
        if (typeof role !== 'string') {
          throw new Error('Invite roles must be strings')
        }
      }

      await context.view.insert('@autobonk/invite', {
        ...data
      })
    })

    this.router.add('@autobonk/revoke-invite', async (data, context) => {
      await this.requirePermission(context.writerKey, 'user:invite')

      const existing = await context.view.get('@autobonk/invite', {
        id: data.id
      })
      if (!existing) return

      const revokedAt =
        typeof data.revokedAt === 'number'
          ? data.revokedAt
          : this._deterministicApplyOrdering({
              blockIndex: context.blockIndex,
              order: 2
            }).timestamp

      await context.view.insert('@autobonk/invite', {
        ...existing,
        revokedAt
      })
    })

    this.router.add('@autobonk/init-context', async (data, context) => {
      // Only allow one context initialization
      const existing = await context.view.findOne('@autobonk/context-init', {})
      if (existing) {
        throw new Error('Context already initialized')
      }

      if (!this._keysEqual(data.creatorKey, context.writerKey)) {
        throw new Error('Creator key must match writer key')
      }

      await context.view.insert('@autobonk/context-init', data)

      // Seed the owner role definition if it does not already exist
      const ownerRole = await context.view.get('@autobonk/role-def', {
        name: OWNER_ROLE_NAME
      })

      if (!ownerRole) {
        const ordering = this._deterministicApplyOrdering({
          blockIndex: context.blockIndex,
          order: 1
        })

        await context.view.insert('@autobonk/role-def', {
          name: OWNER_ROLE_NAME,
          permissions: OWNER_PERMISSIONS,
          rev: 1,
          index: ordering.index,
          timestamp: ordering.timestamp
        })
      }

      // Ensure the creator starts with the owner role
      const existingAcl = await context.view.get('@autobonk/acl-entry', {
        subjectKey: data.creatorKey
      })

      if (!existingAcl) {
        const ordering = this._deterministicApplyOrdering({
          blockIndex: context.blockIndex,
          order: 2
        })

        await context.view.insert('@autobonk/acl-entry', {
          subjectKey: data.creatorKey,
          roles: [OWNER_ROLE_NAME],
          rev: 1,
          index: ordering.index,
          timestamp: ordering.timestamp
        })
      }
    })

    this.router.add('@autobonk/define-role', async (data, context) => {
      await this.requirePermission(context.writerKey, 'role:create')

      await this._assertNextRevision(
        context.view,
        '@autobonk/role-def',
        { name: data.name },
        data.rev
      )

      await context.view.insert('@autobonk/role-def', data)
    })

    this.router.add('@autobonk/grant-roles', async (data, context) => {
      await this.requirePermission(context.writerKey, 'role:assign')

      await this._assertNextRevision(
        context.view,
        '@autobonk/acl-entry',
        { subjectKey: data.subjectKey },
        data.rev,
        'Invalid ACL revision'
      )

      // Validate all roles exist
      for (const roleName of data.roles) {
        const role = await context.view.get('@autobonk/role-def', {
          name: roleName
        })
        if (!role) {
          throw new Error(`Unknown role: ${roleName}`)
        }
      }

      await context.view.insert('@autobonk/acl-entry', data)
    })

    this.router.add('@autobonk/revoke-roles', async (data, context) => {
      await this.requirePermission(context.writerKey, 'role:revoke')

      await this._assertNextRevision(
        context.view,
        '@autobonk/acl-entry',
        { subjectKey: data.subjectKey },
        data.rev,
        'Invalid ACL revision'
      )

      await context.view.insert('@autobonk/acl-entry', data)
    })
  }

  // Ensure we init the context exactly once as the first thing
  async _maybeInitContext() {
    if (this.base.length > 0) return
    if (!this.writable) return

    await this.base.append(
      this.schema.dispatch.encode('@autobonk/init-context', {
        creatorKey: this.base.local.key,
        index: 0,
        timestamp: Date.now()
      })
    )
  }

  // Shared guard to enforce sequential revisions. Call whenever client input must
  // match the next expected revision.
  async _assertNextRevision(view, collection, selector, rev, errorPrefix = 'Invalid revision') {
    const existing = await view.get(collection, selector)
    const expectedRev = existing ? existing.rev + 1 : 1
    if (rev !== expectedRev) {
      throw new Error(`${errorPrefix}: expected ${expectedRev}, got ${rev}`)
    }
  }

  _keysEqual(key1, key2) {
    if (!key1 || !key2) return false

    const buf1 = Buffer.isBuffer(key1) ? key1 : ArrayBuffer.isView(key1) ? b4a.from(key1) : null
    const buf2 = Buffer.isBuffer(key2) ? key2 : ArrayBuffer.isView(key2) ? b4a.from(key2) : null

    if (!buf1 || !buf2) return false

    return b4a.equals(buf1, buf2)
  }

  // Shared path so helpers work both while appending new blocks and while Autobase replays them inside _apply
  _appendOrApply({ base, view, dispatch, collection, record, opts = {} }) {
    if (typeof base.append !== 'function') {
      const { index, timestamp } = this._deterministicApplyOrdering(opts)
      return view.insert(collection, { ...record, index, timestamp })
    }

    const index =
      typeof opts.index === 'number'
        ? opts.index
        : typeof base.length === 'number'
          ? base.length
          : this.base.length

    const timestamp = typeof opts.timestamp === 'number' ? opts.timestamp : Date.now()

    return base.append(
      this.schema.dispatch.encode(dispatch, {
        ...record,
        index,
        timestamp
      })
    )
  }

  _deterministicApplyOrdering(opts = {}) {
    const blockIndex =
      typeof opts.blockIndex === 'number'
        ? opts.blockIndex
        : typeof opts.indexBase === 'number'
          ? opts.indexBase
          : 0
    const order = typeof opts.order === 'number' ? opts.order : 0
    const deterministic = blockIndex * 1000 + order
    const index = typeof opts.index === 'number' ? opts.index : deterministic
    const timestamp = typeof opts.timestamp === 'number' ? opts.timestamp : deterministic
    return { index, timestamp }
  }
}

const noop = () => {}
