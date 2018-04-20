
// Look at existing Goescanning 
// Copy over to new list 


import * as XC from 'trc-httpshim/xclient'
import * as common from 'trc-httpshim/common'

import * as core from 'trc-core/core'

import * as trcSheet from 'trc-sheet/sheet'
import * as trcSheetContents from 'trc-sheet/sheetContents'
import * as trcPoly from 'trc-sheet/polygonHelper';
import * as trcSheetEx from 'trc-sheet/sheetEx'


// Iterate in sequence. 
class TaskHelper {
    public static ForEachAsync<TIn, TOut>(
        inputs: TIn[],
        handler: (item: TIn) => Promise<TOut>):
        Promise<TOut[]> {

        var outputs: TOut[] = [];

        return TaskHelper.Work(inputs, 0, outputs, handler).then(
            () => {
                return outputs;
            });
    }

    private static Work<TIn, TOut>
        (
        inputs: TIn[],
        idx: number,
        outputs: TOut[],
        handler: (item: TIn) => Promise<TOut>)
        : Promise<void> {

        if (idx == inputs.length) {
            return Promise.resolve();
        }
        var item = inputs[idx];

        return handler(item).then((result) => {
            outputs.push(result);
            return this.Work(inputs, idx + 1, outputs, handler);
        });
    }
}


// List of partitions that we created.  
export class Partition {
    parentSheet: trcSheet.SheetClient;
    sheet: trcSheet.SheetClient; // null if not yet created
    name: string;
    dataId: string; // data for the polygon, scoped to parent 
    polyData: trcSheet.IPolygonSchema; // actual data
    countRecords: number;

    public Clone(newParentSheet: trcSheet.SheetClient,
        newSheetId: string,
        newDataId: string): Partition {
        var x = new Partition();
        x.parentSheet = newParentSheet;
        x.sheet = newParentSheet.getSheetById(newSheetId);
        x.name = this.name;
        x.dataId = newDataId;
        x.polyData = this.polyData;
        x.countRecords = -1; // unknown
        return x;
    }

    public static New(
        parentSheet: trcSheet.SheetClient,
        sheet: trcSheet.SheetClient,
        name: string,
        existingCount: number,
        dataId: string,
        polyData: trcSheet.IPolygonSchema) {

        var x = new Partition();
        x.parentSheet = parentSheet;
        x.sheet = sheet;
        x.name = name;
        x.dataId = dataId;
        x.polyData = polyData;
        x.countRecords = existingCount;
        return x;
    }
}

export class GeoCopy {

    // Copy geofencing from src to dest. 
    // This will run recursively 

    public static Copy(
        sheetSrc: trcSheet.SheetClient,
        sheetDest: trcSheet.SheetClient): Promise<void> {

        if (!sheetSrc || !sheetDest) {
            return Promise.resolve();
        }

        var geoSrc = new GeoScan(sheetSrc);
        var geoDest = new GeoScan(sheetDest);

        // Gets all existing partitions in the sheet 
        return geoSrc.GetExistingAsync().then(
            (partitions: Partition[]) => {
                return TaskHelper.ForEachAsync(partitions, partition => {
                    // If same name already exists, nop. 
                    return geoDest.AddAsync(partition).then(
                        (newPartition: Partition) => {
                            // Returns new Partition in the new sheet. 

                            // Now do it recursively 
                            return this.Copy(partition.sheet, newPartition.sheet)
                        });

                }).then(() => { });
            });
    }
}

export class GeoScan {
    private _sheet: trcSheet.SheetClient;
    private _polyHelper: trcPoly.PolygonHelper;

    public constructor(sheet: trcSheet.SheetClient) {
        this._sheet = sheet;
        this._polyHelper = new trcPoly.PolygonHelper(sheet);
    }

    // - Given a sheet, get list of polygons in that sheet.  Return Partition[]
    public GetExistingAsync():
        Promise<Partition[]> {

        var list: Partition[] = [];

        return this._sheet.getChildrenAsync().then(children => {
            return TaskHelper.ForEachAsync(children, child => {
                return this.WorkAsync(child).then(partition => {
                    if (partition != null) {
                        list.push(partition);
                    }
                });
            });
        }).then(() => {
            return list;
        });
    }

    // private _missing: number;
    // private _extra: any = {}; // MAp SheetId --> PolySchema
    // this._partitions[sheetId] =
    // private _partitions: { [id: string]: Partition; }; // Map sheetId --> IPartition

    private WorkAsync(
        child: trcSheet.IGetChildrenResultEntry)
        : Promise<Partition> {
        var sheetId = child.Id;
        var childSheet = this._sheet.getSheetById(sheetId);

        return childSheet.getInfoAsync().then(childInfo => {
            var filter = child.Filter;
            var dataId = GeoScan.GetPolygonIdFromFilter(filter);
            if (dataId == null) {
                // there are child sheets without polygon data. Warn!!
                return null;
            } else {
                return this._polyHelper.getPolygonByIdAsync(dataId).then((polySchema) => {
                    if (polySchema == null) {
                        return null;
                    }
                    else {
                        return Partition.New(
                            this._sheet,
                            this._sheet.getSheetById(child.Id),
                            child.Name,
                            childInfo.CountRecords,
                            dataId,
                            polySchema);
                    }
                });
            }
        });
    }

    // Reverse of CreateFilter expression. Gets the DataId back out. 
    // Returns null if not found
    public static GetPolygonIdFromFilter(filter: string): string {
        if (filter == null) {
            return null;
        }
        var n = filter.match(/IsInPolygon.'(.+)',Lat,Long/i);
        if (n == null) {
            return null;
        }
        var dataId = n[1];
        return dataId;
    }

    // Create TRC filter expression to refer to this polygon 
    private static CreateFilter(dataId: string): string {
        return "IsInPolygon('" + dataId + "',Lat,Long)";
    }

    // add a partition (which may be from another sheet) to this sheet. 
    // Return the new partition belong to this sheet.  
    public AddAsync(
        partition: Partition)
        : Promise<Partition> {

        if (!partition.polyData || !partition.name) {
            return Promise.reject("incomplete partition");
        }

        //console.log("Sheet: " + partition.name);
        //return null;


        var name = partition.name;

        var found: trcSheet.IGetChildrenResultEntry = null;

        // First lookup if sheet by this name already exists? 
        return this._sheet.getChildrenAsync().then(children => {
            for (var i in children) {
                var child = children[i];
                if (child.Name == name) {
                    found = child;
                }
            }
        }).then(() => {
            if (found) {
                // Already exists. Lookup existing 
                return this.WorkAsync(found);
            }


            var vertices: common.IGeoPoint[] = GeoScan.PointsFromSchema(partition.polyData); // $$$ get from polySchema

            return this._polyHelper.createPolygon(name, vertices).then((dataId) => {

                var filter = GeoScan.CreateFilter(dataId);
                return this._sheet.createChildSheetFromFilterAsync(name, filter, false).then((childSheet: trcSheet.SheetClient) => {
                    var sheetId = childSheet.getId();

                    return partition.Clone(this._sheet, sheetId, dataId);
                });
            });

        });
    }


    // inverse of polygonHelper!polygonSchemaFromPoints
    public static PointsFromSchema(poly: trcSheet.IPolygonSchema): common.IGeoPoint[] {
        var pts: common.IGeoPoint[] = [];

        for (var i = 0; i < poly.Lat.length; i++) {
            pts.push({
                Lat: poly.Lat[i],
                Long: poly.Long[i]
            });
        }
        return pts;
    }

}