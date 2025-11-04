import { Context } from '../../index.js'

export class Room extends Context {
  setupRoutes() {
    this.router.add('@room/send-message', async (data, context) => {
      const last = await this.lastMessage()
      const index = last ? last.index + 1 : 1

      await context.view.insert('@room/messages', {
        index,
        ...data
      })
    })
  }

  async allMessages() {
    const messages = await this.base.view.find('@room/messages').toArray()
    return messages
  }

  async sendMessage(text) {
    await this.base.append(this.schema.dispatch.encode('@room/send-message', { text }))
  }

  async lastMessage() {
    return await this.base.view.findOne('@room/messages', {
      reverse: true,
      limit: 1
    })
  }
}
