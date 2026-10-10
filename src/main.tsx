import React from "react";
import {createRoot} from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><Home/></React.StrictMode>);
if("serviceWorker" in navigator)window.addEventListener("load",async()=>{
  try{
    const registration=await navigator.serviceWorker.register("./sw.js",{updateViaCache:"none"});
    const offerRefresh=()=>{
      if(document.getElementById("app-update"))return;
      const notice=document.createElement("div");notice.id="app-update";notice.setAttribute("role","status");
      notice.append("A MOTIONS update is ready. ");
      const button=document.createElement("button");button.textContent="REFRESH APP";button.onclick=()=>window.location.reload();notice.append(button);document.body.append(notice);
    };
    let hadController=Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(hadController)offerRefresh();hadController=true;});
    const check=()=>{if(document.visibilityState==="visible")void registration.update().catch(()=>{});};
    document.addEventListener("visibilitychange",check);
    window.addEventListener("pageshow",check);
    check();
  }catch{/* The app remains usable when installation or update checks are unavailable. */}
});
