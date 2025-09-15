export function extendSchema (schema) {
  const ns = schema.namespace('autobonk')

  ns.register({
    name: 'writer',
    compact: false,
    fields: [
      {
        name: 'key',
        type: 'buffer',
        required: true
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
      }
    ]
  })
}

export function extendDb (db) {
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
}

export function extendDispatch (dispatch) {
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
}
