import javax.inject.Inject
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The repository around this folder: the app itself is rust/ (built for the web by rust/build-web.sh into rust/dist).
val repo: File = rootProject.projectDir.parentFile
@Suppress("UNCHECKED_CAST")
val publicConfig = JsonSlurper().parse(repo.resolve("rust/public-config.json")) as Map<String, String>
// GitHub's run number plus 100: the repository's runs started again from 1 after build 67, and each build must have
// a higher number than the one installed for it to install over it
val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt() + 100
val keystore: String? = System.getenv("MONEY_KEYSTORE")
// -Pmoney.demo=true: the app runs on the made-up demo data, offline (for the emulator screenshots in GitHub Actions).
// Never used for the APK you install.
val demo = (findProperty("money.demo") as String?) == "true"

android {
    namespace = "com.yashdobal.money"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.yashdobal.money"
        manifestPlaceholders["appLabel"] = "@string/app_name"
        minSdk = 26
        targetSdk = 35
        versionCode = runNumber                 // every GitHub build is newer than the last, so it installs over it
        versionName = "1.0.$runNumber"
        buildConfigField("String", "SUPABASE_URL", "\"${publicConfig["SUPABASE_URL"]}\"")
        buildConfigField("String", "SUPABASE_KEY", "\"${publicConfig["SUPABASE_PUBLISHABLE_KEY"]}\"")
        buildConfigField("boolean", "DEMO", demo.toString())
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = System.getenv("MONEY_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MONEY_KEY_ALIAS") ?: "money"
                keyPassword = System.getenv("MONEY_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // the real key in GitHub Actions; a throwaway debug key for test builds on a branch
            signingConfig = signingConfigs.getByName(if (keystore != null) "release" else "debug")
            buildConfigField("boolean", "SMS", "false")
        }
        /* The same app that can read bank SMS (src/releaseSms/AndroidManifest.xml adds the permission). Its own APK,
           because in India Google Play Protect may refuse to install an app from a browser or a file manager that
           asks for SMS: the plain APK always installs, and this one installs over it where the phone allows it. */
        create("releaseSms") {
            initWith(getByName("release"))
            buildConfigField("boolean", "SMS", "true")
        }
        debug { buildConfigField("boolean", "SMS", "false") }
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false; checkReleaseBuilds = false }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

/* The web app inside the APK: the website (rust/dist, built first by rust/build-web.sh), the same build as
   yash-money.pages.dev. syncWeb syncs it into the APK's assets/web on every build. The demo build starts the app on
   its made-up data (window.MONEY_DEMO), as if it were 8 Dec 2026. */
val webOut = layout.buildDirectory.dir("web-dist")
val buildWeb = tasks.register<Exec>("buildWeb") {
    description = "Copies the website from rust/dist into build/web-dist"
    workingDir = repo
    inputs.dir(repo.resolve("rust/dist"))
    inputs.property("demo", demo)
    outputs.dir(webOut)
    val out = webOut.get().asFile.absolutePath
    val flag = if (demo) "sed -i 's|<div id=\"main\"></div>|<div id=\"main\"></div><script>window.MONEY_DEMO=1;window.MONEY_DEMO_AT=\"2026-12-08\"</script>|' '$out/index.html'" else "true"
    commandLine("bash", "-c", "test -f rust/dist/index.html || { echo 'Build the app first: rust/build-web.sh'; exit 1; }; rm -rf '$out' && mkdir -p '$out' && cp -r rust/dist/. '$out' && $flag")
}

abstract class SyncWeb : DefaultTask() {
    @get:InputDirectory abstract val web: DirectoryProperty
    @get:OutputDirectory abstract val assetsDir: DirectoryProperty
    @get:Inject abstract val fs: FileSystemOperations
    @TaskAction fun sync() {
        fs.sync {
            from(web)
            into(assetsDir.dir("web"))
        }
    }
}
val syncWeb = tasks.register<SyncWeb>("syncWeb") {
    dependsOn(buildWeb)
    web.set(webOut)
}
androidComponents {
    onVariants { variant -> variant.sources.assets?.addGeneratedSourceDirectory(syncWeb, SyncWeb::assetsDir) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core-ktx:1.6.1")
}
