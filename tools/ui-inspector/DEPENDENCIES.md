# UI Inspector runtime dependencies

The classpath is generated from Android Studio `tools/base` target `//tools/base/ui-inspector/cli:dump-ui`. Artifact filenames and SHA-256 values are pinned in `classpath.json`.

| Maven coordinate | License |
| --- | --- |
| `at.yawk.lz4:lz4-java:1.11.4` | Apache-2.0 |
| `com.google.code.findbugs:jsr305:3.0.2` | Apache-2.0 |
| `com.google.code.gson:gson:2.11.0` | Apache-2.0 |
| `com.google.errorprone:error_prone_annotations:2.36.0` | Apache-2.0 |
| `com.google.guava:failureaccess:1.0.2` | Apache-2.0 |
| `com.google.guava:guava:33.4.0-jre` | Apache-2.0 |
| `com.google.guava:listenablefuture:9999.0-empty-to-avoid-conflict-with-guava` | Apache-2.0 |
| `com.google.j2objc:j2objc-annotations:3.0.0` | Apache-2.0 |
| `com.google.protobuf:protobuf-java:3.25.5` | BSD-3-Clause; text in `licenses/protobuf-BSD-3-Clause.txt` |
| `info.picocli:picocli:4.7.7` | Apache-2.0 |
| `net.java.dev.jna:jna-platform:5.6.0` | Apache-2.0 or LGPL-2.1-or-later; Apache option selected |
| `net.java.dev.jna:jna:5.14.0` | Apache-2.0 or LGPL-2.1-or-later; Apache option selected |
| `org.checkerframework:checker-qual:3.43.0` | MIT; notice retained in JAR |
| `org.jetbrains:annotations:23.0.0` | Apache-2.0 |
| `org.jetbrains.kotlin:kotlin-stdlib-jdk7:2.2.10` | Apache-2.0 |
| `org.jetbrains.kotlin:kotlin-stdlib-jdk8:2.2.10` | Apache-2.0 |
| `org.jetbrains.kotlin:kotlin-stdlib:2.2.10` | Apache-2.0 |
| `org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.10.2` | Apache-2.0 |
| `org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0` | Apache-2.0 |

Android Studio runtime libraries and device-side inspector resources are covered by Apache-2.0; their attribution is in `NOTICE.txt` and their source revision is in `source.json`.
