import javax.inject.Inject
import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The repository around this folder: the app (rn/), the shared maths (app/), the website build (tools/build_site.py).
val repo: File = rootProject.projectDir.parentFile
@Suppress("UNCHECKED_CAST")
val publicConfig = JsonSlurper().parse(repo.resolve("app/public-config.json")) as Map<String, String>
// GitHub's run number plus 100: the repository's runs started again from 1 after build 67, and each build must have
// a higher number than the one installed for it to install over it
val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt() + 100
val keystore: String? = System.getenv("MONEY_KEYSTORE")
// -Pmoney.demo=true: the app runs on the made-up demo data, offline (for the emulator screenshots in GitHub Actions).
// Never used for the APK you install.
val demo = (findProperty("money.demo") as String?) == "true"
// -Pmoney.rust=true: the Rust app (rust/, built first by rust/build-web.sh into rust/dist) instead of the current one,
// as its own app ("Money · Rust", com.yashdobal.money.rs) that installs beside it. Built by .github/workflows/rust.yml.
val rust = (findProperty("money.rust") as String?) == "true"

android {
    namespace = "com.yashdobal.money"
    compileSdk = 35

    defaultConfig {
        applicationId = if (rust) "com.yashdobal.money.rs" else "com.yashdobal.money"
        manifestPlaceholders["appLabel"] = if (rust) "Money · Rust" else "@string/app_name"
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
        }
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

/* The web app inside the APK: the website, built from Money RN's code (rn/) by tools/build_site.py, the same build as
   yash-money.pages.dev. syncWeb syncs it into the APK's assets/web on every
   build. Needs `npm ci` in rn/ first (the workflow does it). */
val webOut = layout.buildDirectory.dir("web-dist")
val buildWeb = tasks.register<Exec>("buildWeb") {
    description = "Builds the website from rn/ into build/web-dist"
    workingDir = repo
    inputs.dir(repo.resolve("rn/src"))
    inputs.dir(repo.resolve("rn/web"))
    inputs.dir(repo.resolve("rn/assets"))
    inputs.dir(repo.resolve("app"))
    inputs.file(repo.resolve("tools/build_site.py"))
    inputs.file(repo.resolve("tools/rn_engine.mjs"))
    inputs.file(repo.resolve("collector/money-collector.gs"))
    inputs.property("demo", demo)
    inputs.property("rust", rust)
    outputs.dir(webOut)
    val out = webOut.get().asFile.absolutePath
    if (rust) commandLine("bash", "-c", "test -f rust/dist/index.html || { echo 'Build the Rust app first: rust/build-web.sh'; exit 1; }; rm -rf '$out' && mkdir -p '$out' && cp -r rust/dist/. '$out'")
    else if (demo) commandLine("python3", "tools/build_site.py", "--demo", "--out", out)
    else commandLine("python3", "tools/build_site.py", "--out", out)
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
