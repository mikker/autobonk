import ReadyResource from 'ready-resource'
import Hyperswarm from 'hyperswarm'
import Wakeup from 'protomux-wakeup'

export class ContextNetwork extends ReadyResource {
  constructor(store, opts = {}) {
    super()

    this.store = store
    this.bootstrap = opts.bootstrap || null
    this.swarm = null
    this.wakeup = new Wakeup()
    this._onConnection = null

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

    this._onConnection = (connection) => {
      this.store.replicate(connection)
      this.wakeup.addStream(connection)
    }

    this.swarm.on('connection', this._onConnection)
  }

  async _close() {
    if (this.swarm && this._onConnection) {
      this.swarm.off('connection', this._onConnection)
    }

    if (this.swarm) await this.swarm.destroy()
    if (this.wakeup) await this.wakeup.destroy()
  }
}
