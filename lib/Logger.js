process.env["DEBUG"]="*";
import {default as Debug} from "debug";

Debug.formatArgs = function (args) {
	let name = this.namespace;
	let useColors = this.useColors;

	if (useColors) {
		let c = this.color;
		let colorCode = "\u001b[3" + (c < 8 ? c : "8;5;" + c);
		let prefix = colorCode + ";1m" +  new Date().toISOString()  + name + " ";

		args[0] = prefix + args[0].split ("\n").join ("\u001b[0m\n" + prefix) + "\u001b[0m";
	} else {
		args[0] = new Date().toISOString() + name + " " + args[0];
	}
};

class Logger
{
	constructor(name)
	{
		this.name	= name;
		this.info	= Debug(" [INFO ] "+name);
		this.debug	= Debug(" [DEBUG] "+name);
		this.warn	= Debug(" [WARN ] "+name);
		this.error	= Debug(" [ERROR] "+name);
		this.info("created");
	}
	
	child(name)
	{
		return new Logger(this.name +":"+name);
	}
}

export { Logger };
