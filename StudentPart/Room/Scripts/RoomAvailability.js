var allRooms = [];
var fullSchedule = [];

// Default Session Settings
var currentSession = "2025/2026"; 
var currentSem = "1";             
var facultyCode = "FSKSM"; 

(function init() {
    console.log("Room Availability Module Loaded");

    // 1. SESSION DETECTION (From Main.html)
    let parentSesi = window.parent.currentSesi || window.currentSesi;
    let parentSem = window.parent.currentSemester || window.currentSemester;

    if (parentSesi && parentSem) {
        currentSession = parentSesi;
        currentSem = parentSem;
        $("#sessionDisplay").text(`${currentSession} - Semester ${currentSem}`);
    } else {
        $("#sessionDisplay").text(`Default (${currentSession} - Sem ${currentSem})`);
    }

    // 2. Set Date Picker to Today
    var dateInput = document.getElementById('datePicker');
    if(dateInput) dateInput.valueAsDate = new Date();

    // 3. Start Data Fetching
    fetchRoomData();

    // 4. Search Filter Listener
    $("#searchInput").off().on("keyup", function() {
        var value = $(this).val().toLowerCase();
        $("#tableBody tr").filter(function() {
            $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1)
        });
    });
})();

/* --- PART 1: DATA FETCHING --- */

function fetchRoomData() {
    $("#loadingMsg").show(); 
    
    // UPDATED: Uses 'FSKSM' to filter rooms
    var apiUrl = `http://web.fc.utm.my/ttms/web_man_webservice_json.cgi?entity=ruang&kod_fakulti=fsksm`;
    
    console.log("Fetching Rooms from: " + apiUrl);

    $.ajax({
        url: apiUrl,
        type: "GET",
        dataType: "json",
        success: function(roomData) {
            allRooms = roomData;
            console.log(`Success: Fetched ${allRooms.length} rooms.`);
            // Chain the next call
            fetchScheduleData();
        },
        error: function() {
            $("#loadingMsg").html("<span class='w3-text-red'>Failed to load room list. Check connection/CORS.</span>");
        }
    });
}

function fetchScheduleData() {
    // API: entity=jadual_ruang
    // Fetching schedule for ALL rooms in the current session
    var apiUrl = `http://web.fc.utm.my/ttms/web_man_webservice_json.cgi?entity=jadual_ruang&sesi=${currentSession}&semester=${currentSem}`;
    
    console.log("Fetching Schedule from: " + apiUrl);

    $.ajax({
        url: apiUrl,
        type: "GET",
        dataType: "json",
        success: function(schedData) {
            fullSchedule = schedData;
            console.log(`Success: Fetched ${fullSchedule.length} schedule slots.`);
            
            $("#loadingMsg").hide(); 
            generateAvailabilityTable(); // Generate the table
        },
        error: function() {
            $("#loadingMsg").html("<span class='w3-text-red'>Failed to load room schedule.</span>");
        }
    });
}

/* --- PART 2: AVAILABILITY LOGIC --- */

function generateAvailabilityTable() {
    var tbody = $("#tableBody");
    tbody.empty();

    // Get User Inputs
    var dateVal = new Date($("#datePicker").val());
    var dayIndex = dateVal.getDay(); 
    var utmDay = (dayIndex === 0) ? 7 : dayIndex; // Convert Sun(0) to 7

    var startT = parseInt($("#startTime").val());
    var endT = parseInt($("#endTime").val());
    
    var displayTime = $("#startTime option:selected").text() + " - " + $("#endTime option:selected").text();
    var count = 1;

    allRooms.forEach(function(room) {
        // Ensure room has a valid code
        if (room.kod_ruang) {
            
            var isBusy = false;
            
            // Filter the Master Schedule
            var roomClasses = fullSchedule.filter(function(s) {
                // API field mapping: handle variations in JSON structure
                // 'jadual_ruang' usually returns 'kod_ruang' directly, or nested in 'ruang' object
                var scheduleRoomCode = s.kod_ruang || (s.ruang ? s.ruang.kod_ruang : "") || s.ruang_id;
                
                // Compare Room Code AND Day
                return scheduleRoomCode === room.kod_ruang && s.hari == utmDay;
            });

            // Check for Time Overlaps
            roomClasses.forEach(function(cls) {
                var classTime = parseInt(cls.masa);
                // If class is within the user's selected range
                if (classTime >= startT && classTime < endT) {
                    isBusy = true;
                }
            });

            // Visual Status
            var statusHtml = isBusy 
                ? '<span class="status-busy">Occupied</span>' 
                : '<span class="status-avail">Available</span>';

            var shortForm = room.kod_ruang; // e.g., N28_BK1
            var roomName = room.nama_ruang || room.keterangan_ruang || "Lecture Room";
            var category = room.nama_ruang_singkatan || "BK";

            var row = `
                <tr>
                    <td>${count++}</td>
                    <td>${roomName}</td>
                    <td>${shortForm}</td>
                    <td>${category}</td>
                    <td>${displayTime}</td>
                    <td class="w3-center">${statusHtml}</td>
                </tr>
            `;
            tbody.append(row);
        }
    });
    
    if(count === 1) {
        tbody.html("<tr><td colspan='6' class='w3-center'>No rooms found or date invalid.</td></tr>");
    }
}

// Category Filter Function
window.filterCategory = function(cat, element) {
    $(".filter-tags span").removeClass("w3-red active-tag").addClass("w3-light-grey");
    $(element).removeClass("w3-light-grey").addClass("w3-red active-tag");
    
    var value = cat.toLowerCase();
    if (value === "all") {
        $("#tableBody tr").show();
    } else {
        $("#tableBody tr").filter(function() {
            $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
        });
    }
};