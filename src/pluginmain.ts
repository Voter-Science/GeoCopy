// Sample 'Hello World' Plugin template.
// Demonstrates:
// - typescript
// - using trc npm modules and browserify
// - uses promises. 
// - basic scaffolding for error reporting. 
// This calls TRC APIs and binds to specific HTML elements from the page.  

import * as XC from 'trc-httpshim/xclient'
import * as common from 'trc-httpshim/common'

import * as core from 'trc-core/core'

import * as trcSheet from 'trc-sheet/sheet' 
import * as trcSheetEx from 'trc-sheet/sheetEx'


import * as plugin from 'trc-web/plugin'
import * as trchtml from 'trc-web/html'

import * as geo from  './geo'


// Installed via:
//   npm install --save-dev @types/jquery
// requires tsconfig: "allowSyntheticDefaultImports" : true 
declare var $: JQueryStatic;

// Provide easy error handle for reporting errors from promises.  Usage:
//   p.catch(showError);
declare var showError : (error:any) => void; // error handler defined in index.html

export class MyPlugin {
    private _sheet: trcSheet.SheetClient;
    private _pluginClient : plugin.PluginClient;

    public static BrowserEntryAsync(
        auth: plugin.IStart,
        opts : plugin.IPluginOptions
    ) : Promise<MyPlugin> {
        
        var pluginClient = new plugin.PluginClient(auth,opts, null);

        // Do any IO here...
        
        var throwError =false; // $$$ remove this
        
        var plugin2 = new MyPlugin(pluginClient);

        return plugin2.InitAsync().then( () => {
            if (throwError) {
                throw "some error";
            }
            
            return plugin2;                        
        });
    }

     // Expose constructor directly for tests. They can pass in mock versions. 
    public constructor(p : plugin.PluginClient) {
        this._sheet = new trcSheet.SheetClient(p.HttpClient, p.SheetId);
    }
    

    // Make initial network calls to setup the plugin. 
    // Need this as a separate call from the ctor since ctors aren't async. 
    private InitAsync() : Promise<void> {

        return Promise.resolve();

        //var x = geo.GeoCopy.Copy(this._sheet, this._sheet);
        // return x;

        // return this._sheet.getInfoAsync().then( info  => {
        //     this.updateInfo(info);
        // });     
    }

    public OnLookup() : void {
        this.OnLookupAsync().catch(showError);
    }

    private OnLookupAsync() : Promise<void> 
    {
        var otherId = <string> $("#otherSheetId").val();
        var otherSheet = this._sheet.getSheetById(otherId);

        var details = "";

        // Lookup serves as a validation too!
        return otherSheet.getInfoAsync().then( info  => 
            {
                details += "SheetName: " + info.Name;

                var scan = new geo.GeoScan(otherSheet);
                return scan.GetExistingAsync().then(partitions => {
                    details += "\r\nGeofenced into:"
                    for(var i in partitions) {
                        var partition = partitions[i];
                        details += "\r\n   " + partition.name;
                    }
                    
                    $("#details").text(details);
                });
            });      
    }


    public OnCopy() : void {
        this.OnCopyAsync().catch(showError);
    }

    public OnCopyAsync() : Promise<void> 
    {        
        var otherId = <string> $("#otherSheetId").val();
        var otherSheet = this._sheet.getSheetById(otherId);

        return geo.GeoCopy.Copy(otherSheet, this._sheet).then( ()=> {
            alert("Geofence copy complete");
        });;
    }


    // Display sheet info on HTML page
    public updateInfo(info: trcSheet.ISheetInfoResult): void {
        $("#SheetName").text(info.Name);
        $("#ParentSheetName").text(info.ParentName);
        $("#SheetVer").text(info.LatestVersion);
        $("#RowCount").text(info.CountRecords);

        $("#LastRefreshed").text(new Date().toLocaleString());
    }

    // Example of a helper function.
    public doubleit(val: number): number {
        return val * 2;
    }

    // Demonstrate receiving UI handlers 
    public onClickRefresh(): void {
        this.InitAsync().        
            catch(showError);
    }


    // downloading all contents and rendering them to HTML can take some time. 
    public onGetSheetContents(): void {
        trchtml.Loading("contents");
        //$("#contents").empty();
        //$("#contents").text("Loading...");

        trcSheetEx.SheetEx.InitAsync(this._sheet, null).then((sheetEx)=>
        {
            return this._sheet.getSheetContentsAsync().then((contents) => {
                var render = new trchtml.SheetControl("contents", sheetEx);
                // could set other options on render() here
                render.render();
            }).catch(showError);
        });        
    }
}
