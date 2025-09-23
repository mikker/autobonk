import Hyperschema from 'hyperschema'
import HyperdbBuilder from 'hyperdb/builder'
import Hyperdispatch from 'hyperdispatch'
import { extendSchema, extendDb, extendDispatch } from '../../index.js'

const schema = Hyperschema.from('./spec/schema')

extendSchema(schema)

const ns = schema.namespace('room')

ns.register({
  name: 'message',
  compact: false,
  fields: [
    {
      name: 'index',
      type: 'uint',
      required: true
    },
    {
      name: 'text',
      type: 'string',
      requirer: true
    }
  ]
})

ns.register({
  name: 'send-message',
  compact: false,
  fields: [{ name: 'text', type: 'string', required: true }]
})

Hyperschema.toDisk(schema)

const builder = HyperdbBuilder.from('./spec/schema', './spec/db')

extendDb(builder)

const db = builder.namespace('room')

db.collections.register({
  name: 'messages',
  schema: '@room/message',
  key: ['index']
})

HyperdbBuilder.toDisk(builder)

const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/dispatch')

extendDispatch(hyperdispatch)

const dispatch = hyperdispatch.namespace('room')

dispatch.register({
  name: 'send-message',
  requestType: '@room/send-message'
})

Hyperdispatch.toDisk(hyperdispatch)
