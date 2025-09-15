import Hyperschema from 'hyperschema'
import HyperdbBuilder from 'hyperdb/builder'
import Hyperdispatch from 'hyperdispatch'
import { extendSchema, extendDb, extendDispatch } from '../../index.js'

const schema = Hyperschema.from('./spec/schema')

extendSchema(schema)

const ns = schema.namespace('forum')

// Post schema
ns.register({
  name: 'post',
  compact: false,
  fields: [
    {
      name: 'id',
      type: 'string',
      required: true
    },
    {
      name: 'title',
      type: 'string',
      required: true
    },
    {
      name: 'content',
      type: 'string',
      required: true
    },
    {
      name: 'authorKey',
      type: 'buffer',
      required: true
    },
    {
      name: 'createdAt',
      type: 'uint',
      required: true
    }
  ]
})

// Comment schema
ns.register({
  name: 'comment',
  compact: false,
  fields: [
    {
      name: 'id',
      type: 'string',
      required: true
    },
    {
      name: 'postId',
      type: 'string',
      required: true
    },
    {
      name: 'content',
      type: 'string',
      required: true
    },
    {
      name: 'authorKey',
      type: 'buffer',
      required: true
    },
    {
      name: 'createdAt',
      type: 'uint',
      required: true
    }
  ]
})

// Post actions
ns.register({
  name: 'create-post',
  compact: false,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'title', type: 'string', required: true },
    { name: 'content', type: 'string', required: true }
  ]
})

ns.register({
  name: 'delete-post',
  compact: false,
  fields: [{ name: 'postId', type: 'string', required: true }]
})

// Comment actions
ns.register({
  name: 'create-comment',
  compact: false,
  fields: [
    { name: 'id', type: 'string' },
    { name: 'postId', type: 'string', required: true },
    { name: 'content', type: 'string', required: true }
  ]
})

ns.register({
  name: 'delete-comment',
  compact: false,
  fields: [{ name: 'commentId', type: 'string', required: true }]
})

// Permission management
ns.register({
  name: 'setup-roles',
  compact: false,
  fields: []
})

ns.register({
  name: 'promote-user',
  compact: false,
  fields: [
    { name: 'userKey', type: 'string', required: true },
    { name: 'role', type: 'string', required: true }
  ]
})

Hyperschema.toDisk(schema)

const builder = HyperdbBuilder.from('./spec/schema', './spec/db')

extendDb(builder)

const db = builder.namespace('forum')

// Collections
db.collections.register({
  name: 'posts',
  schema: '@forum/post',
  key: ['id']
})

db.collections.register({
  name: 'comments',
  schema: '@forum/comment',
  key: ['id']
})

HyperdbBuilder.toDisk(builder)

const hyperdispatch = Hyperdispatch.from('./spec/schema', './spec/dispatch')

extendDispatch(hyperdispatch)

const dispatch = hyperdispatch.namespace('forum')

// Dispatch handlers
dispatch.register({
  name: 'create-post',
  requestType: '@forum/create-post'
})

dispatch.register({
  name: 'delete-post',
  requestType: '@forum/delete-post'
})

dispatch.register({
  name: 'create-comment',
  requestType: '@forum/create-comment'
})

dispatch.register({
  name: 'delete-comment',
  requestType: '@forum/delete-comment'
})

dispatch.register({
  name: 'setup-roles',
  requestType: '@forum/setup-roles'
})

dispatch.register({
  name: 'promote-user',
  requestType: '@forum/promote-user'
})

Hyperdispatch.toDisk(hyperdispatch)
