(function () {
    // 1. Retrieve the session from localStorage
    const userSession = localStorage.getItem("TTMSFC_userSession");

    // 2. If no session, block access immediately
    if (!userSession) {
        // Detect if the user is currently inside the 'StudentPart' folder

        const isInsideSubfolder = window.location.pathname.includes("StudentPart/");
        //detect if the user is currently inside the 'LecturerPart' folder
        const isInsideLecturerSubfolder = window.location.pathname.includes("LecturerPart/");

        const loginRedirect = isInsideSubfolder || isInsideLecturerSubfolder ? "../login.html" : "login.html";

        // Stop the page from showing even for a millisecond
        document.documentElement.style.display = 'none';

        alert("Unauthorized access! Please login to continue.");

        // Redirect and replace history so 'Back' doesn't work
        window.location.replace(loginRedirect);
    } else {
        // Ensure page is visible if session is valid
        document.documentElement.style.display = 'block';
        console.log("Global Security: Session Verified.");
    }
})();