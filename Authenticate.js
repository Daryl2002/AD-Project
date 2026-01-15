(function () {
    // Context Detection
    const path = window.location.pathname;
    const isInsideAdmin = path.includes("AdminPart");
    const isInsideStudent = path.includes("StudentPart");
    const isInsideLecturer = path.includes("LecturerPart");
    const isSubfolder = isInsideAdmin || isInsideStudent || isInsideLecturer;

    // Determine Required Session
    const sessionKey = isInsideAdmin ? "TTMSFC_adminSession" : "TTMSFC_userSession";
    const session = localStorage.getItem(sessionKey);

    // Validate
    if (!session) {
        // block access immediately
        document.documentElement.style.display = 'none';
        alert("Unauthorized access! Please login.");

        // Redirect based on location
        const loginPage = isSubfolder ? "../Login.html" : "Login.html";
        window.location.replace(loginPage);
    } else {
        // Valid
        document.documentElement.style.display = 'block';
        // console.log("Global Security: Session Verified (" + sessionKey + ")");
    }
})();