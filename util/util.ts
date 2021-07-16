import * as fs from "fs"

export default class Util {

    public static async ReadJSONFile<T>(fileName: string): Promise<T> {
        let result: string = await Util.ReadFile(fileName)
        let parsedResult: T = JSON.parse(result)
        return parsedResult
    }

    public static ReadFile(fileName: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            if (fs.existsSync(fileName)) {
                fs.readFile(fileName, (err, data) => {
                    if (err) {
                        reject(new Error(err.message))
                    } else {
                        resolve(data.toString())
                    }
                })
            } else {
                reject(new Error(`El archivo ${fileName} no existe.`))
            }
        })
    }
    
}