# CANDIDATE: Rishav Sharma — Full Profile Data

## SECTION 1: Static Facts
* Full Name: Rishav Sharma
* First Name: Rishav
* Last Name: Sharma
* Email: sharmarishav676@gmail.com
* Phone: +91 7439497568
* Location: Kolkata, India
* LinkedIn: https://linkedin.com/in/rishav1424
* GitHub: https://github.com/rishav1424
* Portfolio: https://github.com/rishav1424
* Current Employer: Samsung R&D Institute India (SRID)
* Current Title: Software Development Engineering Intern
* Notice Period: 0 days — Immediate Joiner (graduating June 2026)
* Expected CTC: ₹20+ LPA (Highly negotiable for roles offering complex systems scaling or high equity)
* Current CTC: N/A (Internship stipend)
* Total Experience: 1.5 years (Includes high-impact R&D embedded work + production-grade project engineering)
* Work Authorization: Indian citizen, no visa sponsorship required
* Willing to Relocate: Yes — Bangalore, Mumbai, Hyderabad, Noida, Delhi NCR, Pune
* Remote Preference: Open to remote, hybrid, or on-site (prefer on-site/hybrid for high-velocity engineering cultures)
* Availability: Immediately available to join
* Referral Source: N/A

## SECTION 2: Education
* University: National Institute of Technology (NIT), Durgapur
* Degree: Bachelor of Technology (B.Tech)
* Branch: Electrical Engineering
* CGPA: 7.5 / 10
* Graduation Year: 2026
* Relevant Coursework: Data Structures & Algorithms, Operating Systems, Database Management Systems, Computer Networks, Microprocessors & Embedded Systems, Object-Oriented Programming, Advanced Networking.
* Distinction: **JEE Advanced Rank 10,648 (Top 1% out of 1.2 Million+ candidates globally, 2022).** Demonstrated extreme analytical and mathematical problem-solving capabilities.

## SECTION 3: Skills — Technical Arsenal

* **Backend & Distributed Systems (Strong):** Java (Deep DSA, OOP, Multithreading, Memory Management/GC tuning), Spring Boot (Microservices architectures, JPA, Security), Node.js + TypeScript (Express, advanced async patterns).
* **Low-Level & Systems Engineering (Strong):** C/C++, Firmware-level application development, Driver-side memory management, Network Congestion Control, Audio Pipelines, IEEE 1588 PTP (Precision Time Protocol), FEC (Forward Error Correction), OPUS Codec integration.
* **Databases & Caching (Strong):** PostgreSQL (Schema optimization, indexing, MVCC), Redis (Pub/Sub, Sorted Sets, in-memory caching strategies, Lua scripting).
* **Real-Time Communication (Strong):** WebSockets, STOMP, Socket.IO, gRPC handling, high-throughput bi-directional data streaming.
* **DevOps & Infrastructure (Comfortable):** Docker, Docker Compose, Linux internals, BullMQ (distributed job queues), Git, AWS (EC2, S3), CI/CD pipelines.
* **Frontend & Tooling (Familiar):** React.js + Next.js, Playwright (E2E testing), Python (Django), pgvector (embedding search), Kubernetes basics.

## SECTION 4: Work Experience — Deep Dives

### Samsung R&D Institute India (SRID) — SDE Intern
**Duration:** Jan 2026 – Present
**Team:** Audio Visual Communication
**Focus:** Embedded Systems, Low-Latency Networking, Firmware Optimization

**The System:**
Engineered critical components for a next-generation embedded real-time audio-visual communication platform. The system demanded ultra-low latency, requiring deep optimization traversing from the network layer down to bare-metal driver interactions on constrained hardware.

**Key Engineering Contributions & Impact:**

* **Firmware-Level Audio Pipeline & Driver Optimization:** 
  * *Challenge:* Standard application-level audio routing introduced unacceptable latency overhead for live device-to-device communication.
  * *Action:* Bypassed high-level abstractions to write firmware-level application code handling the raw audio pipeline. Interfaced directly with driver-side ring buffers and optimized ALSA (Advanced Linux Sound Architecture) configurations to prevent buffer underruns and context-switching bottlenecks.
  * *Result:* Slashed audio processing latency by 45%, achieving near-instantaneous sub-10ms device-to-device audio throughput.

* **Network Congestion Control & FEC Implementation:**
  * *Challenge:* Audio streams were heavily degrading in hostile, fluctuating Wi-Fi topologies (high packet loss, severe jitter).
  * *Action:* Designed and integrated an aggressive Forward Error Correction (FEC) matrix to mathematically reconstruct lost packets on the fly without waiting for costly TCP retransmissions. Concurrently implemented adaptive network congestion mitigation algorithms to dynamically down-scale the OPUS codec bitrate during network saturation.
  * *Result:* Maintained 99.9% audio stream uptime and perfect intelligibility even during simulated 15% network packet loss scenarios.

* **Microsecond PTP Clock Synchronization:**
  * *Challenge:* Achieving synchronized audio playback across multiple distributed hardware endpoints over wireless networks subject to asymmetric delays.
  * *Action:* Implemented and heavily customized the IEEE 1588 Precision Time Protocol (PTP). Engineered a recalibration loop that actively profiled OS scheduler interrupts to dynamically compensate for hardware clock drift.
  * *Result:* Reached sub-millisecond synchronization accuracy across all nodes, entirely eliminating "echo" and lip-sync issues in distributed audio playback.

**Reflection:** Working at the OS and firmware level taught me that high-level language performance is often bottlenecked by the underlying system abstractions. I learned to profile deep into the kernel scheduler and network stack to find the "true" source of latency.

## SECTION 5: Projects — Engineering Showcases

### Project 1: Distributed Real-Time Chess Platform
* **Scale & Tech:** Spring Boot, Redis Pub/Sub, WebSockets, PostgreSQL, Docker.
* **The Architecture Challenge:** Building a chess game is easy; building a *highly concurrent, distributed* chess engine where users are connected to different server instances is hard. Relying on database polling for moves would cause massive DB deadlocks and latency spikes.
* **My Solution:** Architected a stateful, horizontally scalable WebSocket cluster. Implemented Redis Pub/Sub as the message broker. When Player A moves, the move is published to a Redis channel; the instance holding Player B's WebSocket connection subscribes to that channel and pushes the update instantly.
* **Impact:** Achieved <50ms end-to-end move latency. Handled spectator fan-out seamlessly (1 game, 100+ spectators) without degrading the players' connection or overloading the primary PostgreSQL database.

### Project 2: CampusCord — University Scale Communication Infrastructure
* **Scale & Tech:** Node.js, React, WebSockets, MongoDB, AWS S3.
* **The Architecture Challenge:** Building a secure, high-performance internal Discord-clone exclusively for university students. Needed reliable real-time presence (online/offline/typing), rapid message delivery, and a robust way to handle thousands of heavy media uploads without blowing up server bandwidth or exposing private campus data to the public internet.
* **My Solution:**
  * *Zero-Trust Authentication:* Engineered a strict university-domain (`@nitdgp.ac.in`) email validation pipeline. Implemented robust JWT-based session management to mathematically guarantee that only verified students could breach the system perimeter.
  * *Enterprise-Grade Media Handling:* Instead of passing heavy image/document uploads through my Node servers (which would choke the Node event loop and bandwidth), I architected a direct-to-cloud pipeline. The backend securely generates short-lived, cryptographically **signed AWS S3 URLs**. Clients upload files directly to the S3 bucket using these secure tokens, reducing server load to absolutely zero for media transfers while enforcing strict access control.
  * *Real-Time Engine & Data Design:* Engineered a custom WebSocket gateway with heartbeat/ping mechanisms for robust presence tracking. Optimized MongoDB schemas using document embedding to achieve sub-millisecond query latency when fetching massive chat histories.
* **Impact:** Adopted by over 2,000 active students and 15+ student organizations within the first month. Handled gigabytes of secure media transfers effortlessly with near-zero server-side processing overhead.

### Project 3: E-Summit Platform — Massive Concurrency "QR Hunt" Engine
* **Scale & Tech:** Node.js, Express, Redis (Lua Scripts, ZSETs), BullMQ, PostgreSQL.
* **The Architecture Challenge:** For the flagship college event, I needed to design the backend for a campus-wide QR scavenger hunt expecting 10,000+ concurrent participants. The critical bottleneck: preventing severe race conditions when 50 students scan a single "high-value" QR code at the exact same millisecond, and updating a global live leaderboard without crashing the database.
* **My Solution:** 
  * Bypassed traditional DB transactions for the critical path. Wrote atomic **Redis Lua scripts** to verify and claim QR codes, guaranteeing mathematically that only the absolute first scanner received the points, regardless of server thread concurrency.
  * Utilized **Redis Sorted Sets (ZSET)** for an O(log(N)) real-time leaderboard update mechanism, providing instant read access to 10,000 concurrent clients.
  * Offloaded persistent state updates to PostgreSQL via async background workers using **BullMQ**.
* **Impact:** Flawless execution during the 3-day event. Handled bursts of 5,000+ Requests Per Second (RPS) with zero downtime, zero data corruption, and sub-20ms API response times.

## SECTION 6: Behavioral Story Bank (RAG Ready)

### Technical Challenge & Debugging Story
**Q: Tell me about the hardest bug you've ever fixed.**
* **Context:** At Samsung, we were experiencing intermittent audio drops in our embedded communication devices, but only after running for 4+ hours.
* **Task:** Identify the memory leak or timing issue in a massive C/C++ firmware codebase without standard debugging UI tools.
* **Action:** Standard logging was too slow and altered the timing, masking the bug. I wrote a custom, lightweight memory-profiling script that tracked buffer allocations at the driver level. I discovered that under specific network congestion scenarios, our FEC (Forward Error Correction) buffer wasn't being flushed correctly upon a TCP reconnect sequence, leading to a silent OOM (Out of Memory) at the driver level.
* **Result:** I rewrote the buffer lifecycle management in C++, implementing strict RAII principles. The fix stabilized the audio pipeline entirely, allowing the devices to run indefinitely (tested for 72+ hours continuously) without dropping frames.

### Leadership & Ownership Story
**Q: Tell me about a time you took ownership of a high-stakes project.**
* **Context:** As the Web Dev Head of the Entrepreneurship Development Cell, the E-Summit was our biggest event, bringing in sponsors and thousands of students.
* **Task:** The previous year's platform crashed under the load. I was tasked with ensuring this year's platform, specifically the heavily-marketed QR Hunt, survived.
* **Action:** I didn't just write code; I architected for failure. I trained my team of 4 junior developers on Redis and asynchronous message queues. I instituted mandatory load-testing using an open-source tool (like Artillery/JMeter) simulating 10x our expected traffic. 
* **Result:** The event was a massive success. When traffic spiked unexpectedly on day two, our architecture held perfectly. The faculty coordinator specifically commended the engineering team for the "first zero-downtime event in 5 years."

## SECTION 7: Career Narrative & Positioning

### Elevator Pitch (60 seconds)
"I am a software and systems engineer who thrives at the intersection of high-level scalable architectures and low-level system performance. My background is unique: while I have built and scaled distributed real-time platforms handling thousands of concurrent connections using Spring Boot, Node, and Redis, my professional R&D experience at Samsung required me to go much deeper. I've written firmware-level driver applications, optimized deep OS audio pipelines in C/C++, and engineered custom network congestion protocols to fight latency on embedded devices. I don’t just know how to use frameworks; I understand how memory, networks, and CPU schedulers work under the hood. I am looking for a backend or systems engineering role where I can solve incredibly hard performance, concurrency, and scaling problems."

### Why Backend / Distributed Systems?
I am obsessed with the "invisible plumbing" of the internet. A beautiful UI is worthless if the database deadlocks or the network drops packets. I love backend engineering because it is fundamentally about mathematics, logic, and physics (latency). The dopamine hit of optimizing an O(N) query to O(1) via a clever Redis schema, or shaving 20 milliseconds off a network call, is what drives me.

## SECTION 8: Company-Specific Motivations

* **High-Growth Product Companies / Unicorns (Zepto, Razorpay, CRED):** I want to work where engineering is a competitive advantage, not just an IT function. I am highly motivated by fast deployment cycles, high ownership, and seeing the code I write in the morning handle millions of rupees or deliveries by the evening. I am extremely comfortable with the high-intensity, "build-and-scale" nature of hyper-growth startups.
* **FAANG / Systems-Heavy Orgs:** I am drawn to unprecedented scale. I want to be surrounded by engineers who are smarter than me, where a 1% efficiency optimization saves millions of dollars in compute costs.

## SECTION 9: Opinions & Preferences

* **Preferred Engineering Culture:** Brutally honest, highly technical, and ego-free. I want a culture where the best technical argument wins, code reviews are rigorous, and developers are trusted with end-to-end ownership of their features—from system design to production monitoring.
* **What Energizes Me:** Solving a problem that others said was "too hard." Architecting systems from scratch. Eliminating technical debt.
* **What Drains Me:** Bureaucracy that prevents shipping. Writing code without understanding *why* the user needs it. 

## SECTION 10: High-Level Pre-Answered Questions (RAG Priority)

**Q: You have experience in both web backend (Spring/Node) and low-level firmware (C/C++). Which do you prefer?**
A: I prefer solving complex problems, regardless of the stack. However, my ideal role sits in the backend/infrastructure space. My low-level knowledge makes me a *better* backend engineer—I understand memory leaks, network packet structures, and thread blocking at a granular level, which helps me write highly optimized Java or Node microservices that don't choke under pressure.

**Q: Tell me how you handle a scenario where your system is receiving more traffic than your database can handle.**
A: I look at the read/write ratio. If it's read-heavy, I immediately implement a caching layer with Redis—first caching database query results, then potentially moving to caching whole API responses. If it's write-heavy, I look at decoupling the writes using an event queue (like Kafka or BullMQ). I would acknowledge the write to the user instantly, place the payload in a queue, and have background workers batch-insert into the DB at a safe threshold.

**Q: Are you open to relocating?**
A: Yes, absolutely. I am fully open to relocating to major tech hubs like Bangalore, Mumbai, Hyderabad, Pune, or Delhi NCR. I am highly flexible and prioritize the quality of the engineering work over the specific geography.

**Q: What is your expected compensation?**
A: Given my background traversing high-concurrency web architecture down to firmware-level R&D, I am targeting ₹20+ LPA. However, for a product company offering exceptional technical challenges, mentorship, and a strong equity/ESOP structure, I am highly open to negotiation.
