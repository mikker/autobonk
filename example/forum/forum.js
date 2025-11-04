import { Manager, Context } from '../../index.js'
import * as dispatch from './spec/dispatch/index.js'
import db from './spec/db/index.js'

class ForumContext extends Context {
  constructor(base, schema) {
    super(base, schema)
    this.setupRoutes()
  }

  setupRoutes() {
    this.router.add('@forum/create-post', async (data, context) => {
      await this.requirePermission(context.writerKey, 'post:create')

      const post = {
        id: data.id || Math.random().toString(36).substr(2, 9),
        title: data.title,
        content: data.content,
        authorKey: context.writerKey,
        createdAt: Date.now()
      }

      await context.view.insert('@forum/posts', post)
      return post
    })

    this.router.add('@forum/delete-post', async (data, context) => {
      await this.requirePermission(context.writerKey, 'post:delete')

      const post = await context.view.get('@forum/posts', { id: data.postId })
      if (!post) throw new Error('Post not found')

      await context.view.delete('@forum/posts', { id: data.postId })

      // Also delete all comments on this post
      const comments = await context.view.find('@forum/comments', { postId: data.postId }).toArray()
      for (const comment of comments) {
        await context.view.delete('@forum/comments', { id: comment.id })
      }

      return { deleted: true, postId: data.postId }
    })

    // Comment management
    this.router.add('@forum/create-comment', async (data, context) => {
      await this.requirePermission(context.writerKey, 'comment:create')

      // Verify post exists
      const post = await context.view.get('@forum/posts', { id: data.postId })
      if (!post) throw new Error('Post not found')

      const comment = {
        id: data.id || Math.random().toString(36).substr(2, 9),
        postId: data.postId,
        content: data.content,
        authorKey: context.writerKey,
        createdAt: Date.now()
      }

      await context.view.insert('@forum/comments', comment)
      return comment
    })

    this.router.add('@forum/delete-comment', async (data, context) => {
      await this.requirePermission(context.writerKey, 'comment:delete')

      const comment = await context.view.get('@forum/comments', {
        id: data.commentId
      })
      if (!comment) throw new Error('Comment not found')

      await context.view.delete('@forum/comments', { id: data.commentId })
      return { deleted: true, commentId: data.commentId }
    })

    // Role management shortcuts
    this.router.add('@forum/setup-roles', async (data, context) => {
      console.log('📋 Setting up roles...')

      // Only someone with role:create (owner by default) can set up initial roles
      console.log(
        '🔐 Checking role:create permission for:',
        context.writerKey.toString('hex').slice(0, 8)
      )
      await this.requirePermission(context.writerKey, 'role:create')
      console.log('✅ Permission check passed')

      console.log('🔧 Defining member role...')
      await this.defineRole('member', ['post:create', 'comment:create'], context.writerKey, {
        base: context.base,
        view: context.view,
        blockIndex: context.blockIndex,
        order: 1
      })
      console.log('🔧 Defining moderator role...')
      await this.defineRole(
        'moderator',
        ['post:create', 'comment:create', 'post:delete', 'comment:delete'],
        context.writerKey,
        {
          base: context.base,
          view: context.view,
          blockIndex: context.blockIndex,
          order: 2
        }
      )
      console.log('🔧 Defining reader role...')
      await this.defineRole('reader', [], context.writerKey, {
        base: context.base,
        view: context.view,
        blockIndex: context.blockIndex,
        order: 3
      }) // No permissions, read-only

      console.log('👤 Granting owner member role...')
      await this.grantRoles(context.writerKey, ['owner', 'member'], context.writerKey, {
        base: context.base,
        view: context.view,
        blockIndex: context.blockIndex,
        order: 4
      })
      console.log('✅ Roles setup complete')

      return { message: 'Roles created: reader, member, moderator' }
    })

    this.router.add('@forum/promote-user', async (data, context) => {
      await this.requirePermission(context.writerKey, 'role:assign')

      if (!data.userKey || !data.role) {
        throw new Error('userKey and role required')
      }

      const subjectKey = Buffer.from(data.userKey, 'hex')
      const existing = await context.view.get('@autobonk/acl-entry', {
        subjectKey
      })
      const combinedRoles = new Set([...(existing?.roles || []), data.role])

      await this.grantRoles(subjectKey, [...combinedRoles], context.writerKey, {
        base: context.base,
        view: context.view,
        blockIndex: context.blockIndex,
        order: 1
      })
      return { message: `User promoted to ${data.role}` }
    })
  }

  // Helper methods for accessing forum data
  async getPosts() {
    return await this.base.view.find('@forum/posts', {}).toArray()
  }

  async getPost(id) {
    return await this.base.view.get('@forum/posts', { id })
  }

  async getComments(postId) {
    return await this.base.view.find('@forum/comments', { postId }).toArray()
  }

  async getUserRoles(userKey) {
    const aclEntry = await this.base.view.get('@autobonk/acl-entry', {
      subjectKey: userKey
    })
    return aclEntry ? aclEntry.roles : []
  }
}

// Example usage and testing
async function example() {
  console.log('🏛️  Starting Forum Permissions Example')

  const schema = { db, dispatch }

  const manager = new Manager('./tmp/forum-storage/', {
    ContextClass: ForumContext,
    schema
  })

  try {
    // Create forum context
    const forum = await manager.createContext({ name: 'test-forum' })
    console.log('📝 Forum created')

    // Set up roles (as owner)
    console.log('🚀 Triggering setup-roles action...')
    await forum.base.append(forum.schema.dispatch.encode('@forum/setup-roles', {}))
    console.log('👥 Roles set up: reader, member, moderator')

    // Create some test posts
    await forum.base.append(
      forum.schema.dispatch.encode('@forum/create-post', {
        title: 'Welcome to the Forum!',
        content: 'This is our first post testing the permissions system.'
      })
    )
    console.log('📄 Created post: Welcome to the Forum!')

    // Add a comment to the post - we need to get the post ID first
    const posts = await forum.getPosts()
    const post1 = posts[0]

    if (post1) {
      await forum.base.append(
        forum.schema.dispatch.encode('@forum/create-comment', {
          postId: post1.id,
          content: 'Great first post!'
        })
      )
      console.log('💬 Added comment: Great first post!')
    }

    // Promote owner to moderator to test deletion
    await forum.base.append(
      forum.schema.dispatch.encode('@forum/promote-user', {
        userKey: forum.writerKey.toString('hex'),
        role: 'moderator'
      })
    )
    console.log('📈 Owner promoted to moderator')

    // Now deletion should work
    if (post1) {
      await forum.base.append(
        forum.schema.dispatch.encode('@forum/delete-post', { postId: post1.id })
      )
      console.log('🗑️  Post deleted by moderator')
    }

    // Check final state
    const finalPosts = await forum.getPosts()
    console.log(`📊 Final post count: ${finalPosts.length}`)

    console.log('\n🎉 Forum permissions example completed successfully!')
  } catch (err) {
    console.error('❌ Example failed:', err)
  } finally {
    await manager.close()
  }
}

example().catch(console.error)
