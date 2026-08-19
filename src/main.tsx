import React from "react";
import {createRoot} from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><Home/></React.StrictMode>);
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js"));
