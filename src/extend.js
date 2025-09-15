export function extendSchema(schema) {
  const ns = schema.namespace('autobonk')

  ns.register({
    name: 'writer',
    compact: false,
    fields: [
      {
        name: 'key',
        type: 'buffer',
        required: true
      },
      {
        name: 'isIndexer',
        type: 'bool',
        required: false
      }
    ]
  })

  ns.register({
    name: 'invite',
    compact: false,
    fields: [
      {
        name: 'id',
        type: 'buffer',
        required: true
      },
      {
        name: 'invite',
        type: 'buffer',
        required: true
      },
      {
        name: 'publicKey',
        type: 'buffer',
        required: true
      },
      {
        name: 'expires',
        type: 'int',
        required: true
      },
      {
        name: 'roles',
        type: 'string',
        array: true,
        required: false
      },
      {
        name: 'createdBy',
        type: 'buffer',
        required: false
      },
      {
        name: 'createdAt',
        type: 'uint',
        required: false
      },
      {
        name: 'revokedAt',
        type: 'uint',
        required: false
      }
    ]
  })

  ns.register({
    name: 'revoke-invite',
    compact: false,
    fields: [
      {
        name: 'id',
        type: 'buffer',
        required: true
      },
      {
        name: 'revokedAt',
        type: 'uint',
        required: true
      }
    ]
  })

  ns.register({
    name: 'context-init',
    compact: false,
    fields: [
      {
        name: 'creatorKey',
        type: 'buffer',
        required: true
      },
      {
        name: 'index',
        type: 'uint',
        required: true
      },
      {
        name: 'timestamp',
        type: 'uint',
        required: true
      }
    ]
  })

  ns.register({
    name: 'role-def',
    compact: false,
    fields: [
      {
        name: 'name',
        type: 'string',
        required: true
      },
      {
        name: 'permissions',
        type: 'string',
        array: true,
        required: true
      },
      {
        name: 'rev',
        type: 'uint',
        required: true
      },
      {
        name: 'index',
        type: 'uint',
        required: true
      },
      {
        name: 'timestamp',
        type: 'uint',
        required: true
      }
    ]
  })

  ns.register({
    name: 'acl-entry',
    compact: false,
    fields: [
      {
        name: 'subjectKey',
        type: 'buffer',
        required: true
      },
      {
        name: 'roles',
        type: 'string',
        array: true,
        required: true
      },
      {
        name: 'rev',
        type: 'uint',
        required: true
      },
      {
        name: 'index',
        type: 'uint',
        required: true
      },
      {
        name: 'timestamp',
        type: 'uint',
        required: true
      }
    ]
  })
}

export function extendDb(db) {
  const ns = db.namespace('autobonk')

  ns.collections.register({
    name: 'invite',
    schema: '@autobonk/invite',
    key: ['id']
  })
  ns.collections.register({
    name: 'writer',
    schema: '@autobonk/writer',
    key: ['key']
  })
  ns.collections.register({
    name: 'context-init',
    schema: '@autobonk/context-init',
    key: ['creatorKey']
  })
  ns.collections.register({
    name: 'role-def',
    schema: '@autobonk/role-def',
    key: ['name']
  })
  ns.collections.register({
    name: 'acl-entry',
    schema: '@autobonk/acl-entry',
    key: ['subjectKey']
  })
}

export function extendDispatch(dispatch) {
  const ns = dispatch.namespace('autobonk')

  ns.register({
    name: 'remove-writer',
    requestType: '@autobonk/writer'
  })
  ns.register({
    name: 'add-writer',
    requestType: '@autobonk/writer'
  })
  ns.register({
    name: 'add-invite',
    requestType: '@autobonk/invite'
  })
  ns.register({
    name: 'revoke-invite',
    requestType: '@autobonk/revoke-invite'
  })
  ns.register({
    name: 'init-context',
    requestType: '@autobonk/context-init'
  })
  ns.register({
    name: 'define-role',
    requestType: '@autobonk/role-def'
  })
  ns.register({
    name: 'grant-roles',
    requestType: '@autobonk/acl-entry'
  })
  ns.register({
    name: 'revoke-roles',
    requestType: '@autobonk/acl-entry'
  })
}
