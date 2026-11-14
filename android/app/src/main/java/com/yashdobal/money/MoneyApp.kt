package com.yashdobal.money

import android.app.Application

class MoneyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
        Alerts.schedule(this)         // KEEP: runs on every start without disturbing a job that's already waiting
    }
}
