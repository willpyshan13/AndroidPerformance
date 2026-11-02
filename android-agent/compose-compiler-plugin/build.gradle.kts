plugins {
    kotlin("jvm") version "2.2.21"
}

group = "dev.androidperformance"
version = "1.0.0"

dependencies {
    compileOnly("org.jetbrains.kotlin:kotlin-compiler-embeddable:2.2.21")
}

kotlin { jvmToolchain(17) }

tasks.jar {
    archiveBaseName.set("apw-compose-compiler-plugin")
    archiveVersion.set("")
}
