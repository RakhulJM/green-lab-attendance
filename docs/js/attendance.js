const studentInfo = document.getElementById("studentInfo");
const statusElement = document.getElementById("status");
const timerElement = document.getElementById("timer");
const toggleButton = document.getElementById("toggleButton");
const messageElement = document.getElementById("message");
const historyElement = document.getElementById("history");

let currentEntryTime = null;
let timerInterval = null;

async function getCurrentStudent() {
    const { data, error } = await db.auth.getSession();

    if (error || !data.session) {
        throw new Error("Browser is not registered");
    }

    return await workerRequest("/students/me");
}

async function loadStudent() {
    const student = await getCurrentStudent();

    studentInfo.innerHTML =
        "<strong>" + student.name + "</strong><br>" +
        "Student ID: " + student.student_id;

    return student;
}

async function loadCurrentAttendance() {
    const data = await workerRequest("/attendance/current");

    updateAttendanceUI({
        inside_lab: data.inside_lab,
        entry_time: data.session?.entry_time || null
    });
}

function updateAttendanceUI(data) {
    if (data.inside_lab) {
        currentEntryTime = new Date(data.entry_time);
        statusElement.textContent = "Currently inside Green Lab";
        toggleButton.textContent = "Mark Exit";
        startTimer();
    } else {
        currentEntryTime = null;
        statusElement.textContent = "Currently outside Green Lab";
        toggleButton.textContent = "Mark Entry";
        stopTimer();
        timerElement.textContent = "00:00:00";
    }
}

function startTimer() {
    stopTimer();

    function updateTimer() {
        if (!currentEntryTime) return;

        const difference = Math.max(
            0,
            Math.floor((Date.now() - currentEntryTime.getTime()) / 1000)
        );

        const hours = Math.floor(difference / 3600);
        const minutes = Math.floor((difference % 3600) / 60);
        const seconds = difference % 60;

        timerElement.textContent =
            String(hours).padStart(2, "0") + ":" +
            String(minutes).padStart(2, "0") + ":" +
            String(seconds).padStart(2, "0");
    }

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

async function toggleAttendance() {
    toggleButton.disabled = true;
    messageElement.textContent = "Recording...";

    try {
        const current = await workerRequest("/attendance/current");

        if (!current.inside_lab) {
            const result = await workerRequest("/attendance/entry", {
                method: "POST"
            });

            const session = Array.isArray(result) ? result[0] : result;

            messageElement.textContent = "Entry recorded successfully.";

            updateAttendanceUI({
                inside_lab: true,
                entry_time: session?.entry_time || new Date().toISOString()
            });
        } else {
            const result = await workerRequest("/attendance/exit", {
                method: "POST"
            });

            const session = Array.isArray(result) ? result[0] : result;

            messageElement.textContent =
                "Exit recorded. Time spent: " +
                (session?.duration_minutes ?? 0) +
                " minutes.";

            updateAttendanceUI({
                inside_lab: false,
                entry_time: null
            });
        }

        await loadHistory();
    } catch (error) {
        console.error(error);
        messageElement.textContent =
            error?.message || "Could not record attendance. Please try again.";
    } finally {
        toggleButton.disabled = false;
    }
}

async function loadHistory() {
    try {
        const data = await workerRequest("/attendance/history");

        if (!data || data.length === 0) {
            historyElement.textContent = "No attendance records yet.";
            return;
        }

        historyElement.innerHTML = data.map((session) => {
            const duration =
                session.duration_minutes === null ||
                session.duration_minutes === undefined
                    ? "Active"
                    : session.duration_minutes + " min";

            return (
                '<div class="history-item">' +
                "<div><strong>Entry:</strong> " + formatAttendanceTime(session.entry_time) + "</div>" +
                "<div><strong>Exit:</strong> " +
                (session.exit_time ? formatAttendanceTime(session.exit_time) : "Inside Lab") +
                "</div>" +
                "<div><strong>Duration:</strong> " + duration + "</div>" +
                "</div>"
            );
        }).join("");
    } catch (error) {
        console.error(error);
        historyElement.textContent = "Unable to load attendance history.";
    }
}

const DISPLAY_TIME_ZONE = "Asia/Kolkata";

function formatAttendanceTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("en-IN", {
        timeZone: DISPLAY_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).format(date);
}

function getScanAction() {
    return new URLSearchParams(window.location.search).get("action");
}

async function handleQRScan() {
    const action = getScanAction();

    if (action !== "entry" && action !== "exit") return;

    window.history.replaceState({}, document.title, window.location.pathname);

    if (action === "entry") {
        const current = await workerRequest("/attendance/current");
        if (current.inside_lab) {
            messageElement.textContent = "You are already inside Green Lab.";
            return;
        }

        const result = await workerRequest("/attendance/entry", {
            method: "POST"
        });

        const session = Array.isArray(result) ? result[0] : result;

        updateAttendanceUI({
            inside_lab: true,
            entry_time: session?.entry_time || new Date().toISOString()
        });

        messageElement.textContent = "Entry recorded successfully.";
        await loadHistory();
        return;
    }

    const current = await workerRequest("/attendance/current");

    if (!current.inside_lab) {
        messageElement.textContent = "No active entry found.";
        return;
    }

    const result = await workerRequest("/attendance/exit", {
        method: "POST"
    });

    const session = Array.isArray(result) ? result[0] : result;

    updateAttendanceUI({
        inside_lab: false,
        entry_time: null
    });

    messageElement.textContent =
        "Exit recorded. Time spent: " +
        (session?.duration_minutes ?? 0) +
        " minutes.";

    await loadHistory();
}


function scheduleAutomaticCloseRefresh() {
    const now = new Date();
    const target = new Date(now);

    const parts = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);

    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    target.setUTCFullYear(get("year"), get("month") - 1, get("day"));
    target.setUTCHours(11, 1, 0, 0);

    if (target.getTime() <= now.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    setTimeout(async () => {
        try {
            await loadCurrentAttendance();
            await loadHistory();
        } catch (error) {
            console.error("Automatic 4:30 PM refresh failed:", error);
        } finally {
            scheduleAutomaticCloseRefresh();
        }
    }, delay);
}

async function start() {
    try {
        await loadStudent();
        await loadCurrentAttendance();
        await loadHistory();
        await handleQRScan();
    } catch (error) {
        console.error(error);

        studentInfo.textContent = "This browser is not registered.";
        statusElement.textContent = "Please register this browser first.";
        toggleButton.disabled = true;
        messageElement.innerHTML = '<a href="index.html">Student Registration</a>';
    }
}

toggleButton.addEventListener("click", toggleAttendance);
start();