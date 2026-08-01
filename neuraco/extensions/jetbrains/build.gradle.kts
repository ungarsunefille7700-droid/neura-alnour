plugins {
    java
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "com.neura.neuraco"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
        intellijDependencies()
    }
}

dependencies {
    intellijPlatform {
        intellijIdea("2025.3")
        pluginVerifier()
        zipSigner()
    }
    implementation("com.google.code.gson:gson:2.13.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
    testRuntimeOnly("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.13.4")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

intellijPlatform {
    buildSearchableOptions = false
    instrumentCode = false
    pluginConfiguration {
        name = "NeuraCo"
        version = project.version.toString()
        description = """
            NeuraCo connects JetBrains IDEs to NeuraCo Desktop and securely
            shares conversations, agents, rules, models, and usage.
        """.trimIndent()
        ideaVersion {
            sinceBuild = "253"
        }
        vendor {
            name = "NEURA AL-NOUR"
        }
    }
    pluginVerification {
        ides {
            recommended()
        }
    }
}

tasks {
    withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
        options.release.set(21)
    }
    test {
        useJUnitPlatform()
    }
}
